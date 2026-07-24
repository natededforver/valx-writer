// ---------------------------------------------------------------------------
// Spellchecking, owned by the app rather than by the OS webview.
//
// WebView2's built-in checker can't be steered from the host: no way to pick a
// language, no way to read its suggestions, and — the reason this module
// exists — no way to add a word to its dictionary. The renderer therefore turns
// the native checker off (spellcheck="false" on the editor) and asks these
// commands instead, which run a Hunspell-compatible checker over a dictionary
// baked into the binary.
//
//   spell_check       – words in, misspelled words out (one round trip per
//                       edit, not one per word)
//   spell_suggest     – correction candidates for a single word
//   spell_add_word    – add to the user dictionary, persisted to disk
//   spell_user_words  – the user dictionary, for restoring it on launch
//
// The user dictionary is a plain newline-delimited file in the app's data dir.
// It is applied on top of the bundled dictionary at load time and whenever a
// word is added, so "Add to Dictionary" takes effect on the next check with no
// restart.
// ---------------------------------------------------------------------------

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const AFF: &str = include_str!("../dictionaries/en_US.aff");
const DIC: &str = include_str!("../dictionaries/en_US.dic");

/// The compiled dictionary. Built once on first use — parsing the .dic costs
/// real time, and every command below would otherwise pay it again.
static DICT: OnceLock<Option<spellbook::Dictionary>> = OnceLock::new();

/// Words the user added. Kept in memory as the authority for checks (the
/// bundled dictionary is immutable once compiled) and mirrored to disk.
static USER_WORDS: OnceLock<Mutex<BTreeSet<String>>> = OnceLock::new();

fn dict() -> Option<&'static spellbook::Dictionary> {
    DICT.get_or_init(|| spellbook::Dictionary::new(AFF, DIC).ok())
        .as_ref()
}

fn user_words() -> &'static Mutex<BTreeSet<String>> {
    USER_WORDS.get_or_init(|| Mutex::new(BTreeSet::new()))
}

fn user_dict_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("user-dictionary.txt"))
}

/// Load the on-disk user dictionary into memory. Called once from setup(); a
/// missing or unreadable file just means an empty user dictionary.
pub fn load_user_dictionary(app: &tauri::AppHandle) {
    let Some(path) = user_dict_path(app) else { return };
    let Ok(text) = std::fs::read_to_string(path) else { return };
    if let Ok(mut set) = user_words().lock() {
        set.extend(text.lines().map(str::trim).filter(|w| !w.is_empty()).map(String::from));
    }
}

/// True when the word is spelled correctly. Checked against the user dictionary
/// first (it is the smaller set and the one the user explicitly curated), then
/// the bundled one.
fn is_correct(word: &str) -> bool {
    if word.is_empty() {
        return true;
    }
    if let Ok(set) = user_words().lock() {
        if set.contains(word) || set.contains(&word.to_lowercase()) {
            return true;
        }
    }
    match dict() {
        // No dictionary compiled (corrupt bundle) — call everything correct
        // rather than underlining the user's entire document in red.
        None => true,
        Some(d) => d.check(word),
    }
}

/// Words from `words` that are misspelled. Taking the whole batch in one call
/// keeps this to a single IPC round trip per edit; the renderer diffs the
/// result against what it already has underlined.
#[tauri::command]
pub fn spell_check(words: Vec<String>) -> Vec<String> {
    words.into_iter().filter(|w| !is_correct(w)).collect()
}

/// Correction candidates for one word, best first. Capped because this feeds a
/// context menu — a list longer than a handful is unusable there.
#[tauri::command]
pub fn spell_suggest(word: String) -> Vec<String> {
    let Some(d) = dict() else { return Vec::new() };
    let mut out = Vec::new();
    d.suggest(&word, &mut out);
    out.truncate(8);
    out
}

/// Add a word to the user dictionary and persist it. Returns false only if the
/// word could not be written to disk — the in-memory add still happened, so the
/// current session honours it either way.
#[tauri::command]
pub fn spell_add_word(app: tauri::AppHandle, word: String) -> bool {
    let word = word.trim().to_string();
    if word.is_empty() {
        return false;
    }
    let snapshot = {
        let Ok(mut set) = user_words().lock() else { return false };
        set.insert(word);
        set.iter().cloned().collect::<Vec<_>>()
    };
    let Some(path) = user_dict_path(&app) else { return false };
    std::fs::write(path, snapshot.join("\n")).is_ok()
}

/// Remove a word from the user dictionary (the Dictionary… manager in the Edit
/// menu). Same persistence contract as spell_add_word.
#[tauri::command]
pub fn spell_remove_word(app: tauri::AppHandle, word: String) -> bool {
    let snapshot = {
        let Ok(mut set) = user_words().lock() else { return false };
        set.remove(word.trim());
        set.iter().cloned().collect::<Vec<_>>()
    };
    let Some(path) = user_dict_path(&app) else { return false };
    std::fs::write(path, snapshot.join("\n")).is_ok()
}

/// The whole user dictionary, sorted.
#[tauri::command]
pub fn spell_user_words() -> Vec<String> {
    user_words().lock().map(|s| s.iter().cloned().collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // One runnable check over the whole path: a real word passes, a mangled one
    // fails and yields suggestions, and a word added to the user dictionary
    // stops being reported. Run with `cargo test -p valx-prose-writer`.
    #[test]
    fn checks_suggests_and_accepts_user_words() {
        assert!(is_correct("writer"), "a dictionary word must pass");
        assert!(!is_correct("wrtier"), "a misspelling must fail");

        let bad = spell_check(vec!["writer".into(), "wrtier".into()]);
        assert_eq!(bad, vec!["wrtier".to_string()]);

        assert!(
            spell_suggest("wrtier".into()).iter().any(|s| s == "writer"),
            "suggestions should reach the intended word"
        );

        // Adding bypasses the disk write (no AppHandle in a unit test) but
        // exercises the same in-memory set every check consults.
        user_words().lock().unwrap().insert("Valx".into());
        assert!(is_correct("Valx"), "user-dictionary words must be accepted");
        assert!(spell_check(vec!["Valx".into()]).is_empty());
    }
}

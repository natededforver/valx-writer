// ---------------------------------------------------------------------------
// Spellchecking, owned by the app rather than by the OS webview.
//
// WebView2's built-in checker can't be steered from the host: no way to pick a
// language, no way to read its suggestions, and — the reason this module
// exists — no way to add a word to its dictionary. The renderer therefore turns
// the native checker off (spellcheck="false" on the editor) and asks these
// commands instead, which run a Hunspell-compatible checker over the
// dictionaries baked into the binary (English, French, German, Italian,
// Spanish — see DICTS; the renderer names one per call).
//
//   spell_check       – language + words in, misspelled words out (one round
//                       trip per edit, not one per word)
//   spell_suggest     – correction candidates for a single word
//   spell_add_word    – add to the user dictionary, persisted to disk
//   spell_user_words  – the user dictionary, for restoring it on launch
//
// The user dictionary is a plain newline-delimited file in the app's data dir.
// It is applied on top of the bundled dictionary at load time and whenever a
// word is added, so "Add to Dictionary" takes effect on the next check with no
// restart.
// ---------------------------------------------------------------------------

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

/// The bundled dictionaries, keyed by the name the renderer sends (which is
/// also the file stem). Baked into the binary with include_str! rather than
/// shipped as Tauri resources: no path resolution at runtime, no missing-file
/// failure mode, and the renderer can switch language without any IO.
const DICTS: &[(&str, &str, &str)] = &[
    ("en_US", include_str!("../dictionaries/en_US.aff"), include_str!("../dictionaries/en_US.dic")),
    ("French", include_str!("../dictionaries/French.aff"), include_str!("../dictionaries/French.dic")),
    ("German", include_str!("../dictionaries/German.aff"), include_str!("../dictionaries/German.dic")),
    ("Italian", include_str!("../dictionaries/Italian.aff"), include_str!("../dictionaries/Italian.dic")),
    ("Spanish", include_str!("../dictionaries/Spanish.aff"), include_str!("../dictionaries/Spanish.dic")),
];

/// Compiled dictionaries, one entry per language actually used this session.
/// Parsing a .dic costs real time (German's is 3.8 MB), so it happens once and
/// only for the languages the user picks — a startup that compiled all five
/// would pay for four nobody asked for.
static COMPILED: OnceLock<Mutex<HashMap<&'static str, Option<&'static spellbook::Dictionary>>>> =
    OnceLock::new();

/// Words the user added. Kept in memory as the authority for checks (the
/// bundled dictionary is immutable once compiled) and mirrored to disk.
static USER_WORDS: OnceLock<Mutex<BTreeSet<String>>> = OnceLock::new();

/// The compiled dictionary for `lang`, falling back to English for a name that
/// isn't bundled (a stale preference must not silently disable spellchecking).
fn dict(lang: &str) -> Option<&'static spellbook::Dictionary> {
    let (name, aff, dic) = DICTS
        .iter()
        .find(|(n, _, _)| *n == lang)
        .or_else(|| DICTS.first())?;
    let mut compiled = COMPILED.get_or_init(Default::default).lock().ok()?;
    *compiled.entry(name).or_insert_with(|| {
        // ponytail: leaked on purpose — one allocation per language, kept for
        // the life of the process anyway, and it buys a plain &'static return
        // instead of threading a guard through every command.
        spellbook::Dictionary::new(aff, dic).ok().map(|d| &*Box::leak(Box::new(d)))
    })
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
fn is_correct(lang: &str, word: &str) -> bool {
    if word.is_empty() {
        return true;
    }
    if let Ok(set) = user_words().lock() {
        if set.contains(word) || set.contains(&word.to_lowercase()) {
            return true;
        }
    }
    match dict(lang) {
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
pub fn spell_check(lang: String, words: Vec<String>) -> Vec<String> {
    words.into_iter().filter(|w| !is_correct(&lang, w)).collect()
}

/// Correction candidates for one word, best first. Capped because this feeds a
/// context menu — a list longer than a handful is unusable there.
#[tauri::command]
pub fn spell_suggest(lang: String, word: String) -> Vec<String> {
    let Some(d) = dict(&lang) else { return Vec::new() };
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
        assert!(is_correct("en_US", "writer"), "a dictionary word must pass");
        assert!(!is_correct("en_US", "wrtier"), "a misspelling must fail");

        let bad = spell_check("en_US".into(), vec!["writer".into(), "wrtier".into()]);
        assert_eq!(bad, vec!["wrtier".to_string()]);

        assert!(
            spell_suggest("en_US".into(), "wrtier".into()).iter().any(|s| s == "writer"),
            "suggestions should reach the intended word"
        );

        // Adding bypasses the disk write (no AppHandle in a unit test) but
        // exercises the same in-memory set every check consults.
        user_words().lock().unwrap().insert("Valx".into());
        assert!(is_correct("en_US", "Valx"), "user-dictionary words must be accepted");
        assert!(spell_check("en_US".into(), vec!["Valx".into()]).is_empty());
    }

    // Every bundled dictionary must actually compile, and switching language
    // must switch the verdict — "bonjour" is a misspelling in English and a
    // word in French. An unknown name falls back to English rather than
    // silently passing everything.
    #[test]
    fn every_bundled_language_compiles() {
        for (name, _, _) in DICTS {
            assert!(dict(name).is_some(), "{name} failed to compile");
        }
        assert!(!is_correct("en_US", "bonjour"));
        assert!(is_correct("French", "bonjour"));
        assert!(!is_correct("Klingon", "wrtier"), "unknown language falls back to English");
    }
}

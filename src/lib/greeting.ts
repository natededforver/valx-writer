// Sidebar header greeting — replaces the logo/wordmark for an immersive feel.
// Two kinds, mixed: the time-of-day one (Good morning/afternoon/evening) and a
// random quirky word, Minecraft-splash-text style. Night-flavored words are
// drawn from a separate pool and only mixed in after 7 PM (system-local hour,
// so this is naturally correct in whatever timezone the device is set to — no
// extra timezone handling needed).

export const QUIRKY_DAY: string[] = [
  'Hi.', 'Hello.', 'Hey.', 'Hey.. Hey you.', "It's time.", 'Welcome back.', 'Greetings.',
  'How are you?', 'Howdy.', 'Ahoy.', 'Hiya.', 'Good to see you.', "Lets write.",
  'Ready?', 'Onward.', 'Make magic.', 'Fresh page.', 'Tap. Tap. Tap.', 'New Beginning.',
  'Wonderful day.', 'Write on.', 'Keep going.', 'One more page.',
  'Your world awaits your return.', 'Story time?', 'Back again.', 'Rise and shine, Freeman.',
  'Spill everything!!', 'Catch the thought.', 'Blank page.', 'Write something.',
  'Speak your mind.', 'Unwind.', 'Just you and me.',
  'Whenever you are ready.', 'No rush.',
  'Take your time.', 'Pen down.', 'Type away.', 'Here we go.', 'Hola, amigo!',
  'Welcome.', 'Good to have you.', "Glad you're here.", 'Nice to meet you.',
  'We meet again.', 'Something new?', 'A fresh start.', 'You again.',
  'New world.', 'Hello, there.', 'New.md', '7 mins.',
  'The page is yours.', 'Chapter one..', 'Finished doom scrolling?',
  'Oh, What happens next?', 'You are a wizard.', 'One word at a time.',
  'Ready when you are.', 'The blank stares back.', 'Fill the silence.',
  'Small steps, real progress.', 'Today, a paragraph.', 'Character check.',
  'Interesting.', 'Every draft starts messy.', 'Show, then tell.',
  'First line is the hardest.', 'Momentum > perfection.', 'Just start typing.',
  'We were expecting you.', 'Ideas, unfiltered.', 'Start a Rough draft.',
  'Punctuation later.', "Dont overthink.", 'Write as it flows.',
  'A page a day.', 'Leave the quiet part for the readers.', 'New lines.',
  'Where were we?', 'Continue the story.', 'Back to it.',
  'Spellcheck some of that.', "Lets go.", 'Prose o\'clock.',
  'Time to type.', 'Welcome, home.', 'Home again.',
  'Keep writing.', 'New idea?', 'You need a tea break.', 'Type on.',
  'Editing is for later.', 'Draft, revise, repeat.', 'Check. Check.',
  'Try something new.', 'Make yourself at home.', 'Write toward your goals.',
  'Your stories need your emotions.', 'Ive been waiting for you.', 'Setting the scene?',
  'Dialogue, Dialogue.', 'Done with Descriptions?', 'Skip the outline today.',
  'Trust your words.', 'One more paragraph.', 'Word by word.',
  'Nothing is final yet.', 'Delete.. Delete. Delete!!!', 'Bold first attempt.',
  'Warm up the fingers.', 'Stretch, then write.', 'Coffee and commas.',
  'Tea and typos.', 'A quiet page.', 'Room to think.',
  'Space to write.', 'Your words, your pace.', 'No editor watching.',
  'Just you and me here.', 'Type first, judge later.', 'This is the 10th layer of hell.',
  'So much unfinished drafts.', 'Use real pen and paper too.', 'A little chaos helps.',
  'First draft, best draft (for now).', 'Semicolons optional.',
  'No adverbs.', 'The narrator returns.', 'Page turn.',
  'What if...', 'Try the weird idea.', 'You are at the right place.',
  'Circle back later.', 'Anything new on TV?', 'Cut the rest tomorrow.',
  'Start with a sentence.', '24k magic.opus', 'Pg. 1',
];

export const QUIRKY_NIGHT: string[] = [
  'Still up?', 'Night owl.', 'Burning the midnight oil.', 'Quiet hours.',
  'This is your domain.', 'Midnight muse.', 'Another coffee break?',
  'The house is quiet now.', 'Nocturnal silence.', 'Small hours, big ideas.',
  'Everyone else is asleep.', 'The dark makes good drafts.',
  'Lamp-lit thoughts.', 'Insomnia, but atleast productive.',
  'Be loud with your ideas.', 'Stars out, go and see it.',
  'Night-shift writer.', 'Use proper lighting.',
  'Late-night confessions (fictional, probably).', "Its never late.",
  'One more page before sleep.', 'Take your time, the night is long.',
  'Whisper it onto the page.', 'Guess who is back again.',
  'Keep up.', 'Like moth to the fire.',
  'Quiet keys, loud thoughts.', 'Raise the stakes!',
  '#blessed', 'The dark is good for editing.',
  'Between yesterday and tomorrow.', 'A page before the dawn.',
  'Bring me to life.opus', 'Whatever happens, happens.', 'Harder, Better, Faster, Stronger.',
  'No plans tonight. Lets focus.', 'The 2 AM idea is important.',
  'No woulds, coulds, shoulds, Its just is and we are.', 'Read BLAME!',
  'Tomorrow can wait.', 'Backlight is sufficient.', 'The time is yours.',
  'Sleep is for the losers.', 'Treasure.opus',
];

/** How often the time-of-day greeting wins over a quirky word, when the hour
 *  has one to offer. It used to be once per calendar day, which in practice
 *  meant almost never seeing it: one launch would spend the day's allowance and
 *  every launch after it got a random word. A share of every launch keeps both
 *  kinds in rotation, which is the point of having two. */
const TIME_GREETING_SHARE = 0.35;

/** The greeting for `date`'s hour, or null outside the named parts of the day
 *  (after 9 PM there is no "good night" — that hour has its own word pool). */
export function timeGreeting(date = new Date()): string | null {
  const h = date.getHours();
  if (h >= 5 && h <= 11) return 'Good morning.';
  if (h >= 12 && h <= 16) return 'Good afternoon.';
  if (h >= 17 && h <= 20) return 'Good evening.';
  return null;
}

/** Greeting for the sidebar header. Mostly a random quirky word; sometimes the
 *  hour's own greeting. Night-themed words only join the pool after 7 PM.
 *
 *  `rand` is injectable so the mix is testable — the split is a behaviour worth
 *  pinning, and a test that reaches for Math.random can only assert "it did not
 *  crash". */
export function greeting(date = new Date(), rand: () => number = Math.random): string {
  const timed = timeGreeting(date);
  if (timed && rand() < TIME_GREETING_SHARE) return timed;

  const h = date.getHours();
  const isNight = h >= 19 || h < 5;
  const pool = isNight ? QUIRKY_DAY.concat(QUIRKY_NIGHT) : QUIRKY_DAY;
  return pool[Math.floor(rand() * pool.length)];
}

const GREETING_CACHE_KEY = 'valx-greeting-cache';

/** greeting(), cached to the current hour. Sidebar remounts on things like the
 *  fullscreen-toggle double-click; without this the quirky word rerolled on
 *  every one of those instead of once an hour / per reload. */
export function sessionGreeting(): string {
  const hourKey = new Date().toISOString().slice(0, 13);
  const cached = localStorage.getItem(GREETING_CACHE_KEY);
  const sep = cached?.indexOf('|') ?? -1;
  if (cached && sep >= 0 && cached.slice(0, sep) === hourKey) return cached.slice(sep + 1);
  const word = greeting();
  localStorage.setItem(GREETING_CACHE_KEY, `${hourKey}|${word}`);
  return word;
}

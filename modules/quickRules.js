const Sentiment = require('sentiment');
const senti = new Sentiment();

const rules = [
  {                              // “dance!”
    test   : t => /dance|baila/i.test(t),
    action : c => c.performContextAction()
  },
  {                              // user angry ➞ calm them
    test   : t => senti.analyze(t).score < -3,
    action : (c,s) => c.sendChat(`Chill ${s}, all good 🤗`)
  }
];

async function run(client, sender, text) {
  for (const r of rules) if (r.test(text)) await r.action(client, sender);
}

module.exports = { run };

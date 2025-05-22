// modules/topicExtractor.js
const compromise = require('compromise');  // or any light NLP library

// Very basic: grab nouns & verbs, strip out stop-words and very short tokens
function extractTopics(text, { lang = 'en' } = {}) {
  const doc = compromise(text.toLowerCase());
  const nouns = doc.nouns().out('array');
  const verbs = doc.verbs().out('array');
  const candidates = [...nouns, ...verbs];

  const stopWords = new Set([
    'hello','hi','hey','please','thanks','yes','no',
    'the','a','an','and','or','but','if','to','of','in'
  ]);

  return [...new Set(
    candidates
      .map(w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))  // strip accents
      .filter(w => w.length > 3 && !stopWords.has(w))
  )];
}

module.exports = { extractTopics };

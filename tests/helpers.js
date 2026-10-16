const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'playbooks.json'), 'utf8'));
const core = require('../js/core.js');

/** Every combination of answers for a category, as { questionIndex: answerKey }. */
function allAnswerSets(category) {
  const qs = data.playbooks[category].questions;
  const sets = [];
  for (let mask = 0; mask < (1 << qs.length); mask++) {
    const answers = {};
    qs.forEach((q, i) => { answers[i] = (mask >> i) & 1 ? q.yes : q.no; });
    sets.push(answers);
  }
  return sets;
}

const categoryIds = data.categories.map(c => c.id);
module.exports = { root, data, core, allAnswerSets, categoryIds };

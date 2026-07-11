'use strict';

const assert = require('assert');
const parser = require('./server.js');

const subjects = parser.parseSubjectsHtml(`
  <ul>
    <li class="active" onclick="selectProject('ABCDEF1234')" id="p_ABCDEF1234">History</li>
  </ul>
`);
assert.deepStrictEqual(subjects, [{ guid: 'ABCDEF1234', name: 'History' }]);

const meta = parser.parseMetaHtml(`
  <label><input value="1" name="theme" type="checkbox"> Section</label>
  <label><input type=checkbox name=qkind value='SHORT_ANSWER'> Short answer</label>
`);
assert.deepStrictEqual(meta.themes, [{ code: '1', title: 'Section', isSection: true }]);
assert.deepStrictEqual(meta.qkinds, [{ code: 'SHORT_ANSWER', title: 'Short answer' }]);

const page = parser.parseTasksPage(`
  setQCount(1)
  <div id="qA1B2" data-x="1" class="foo qblock">
    <form>
      <input value="GUID123" name="guid">
      <table>
        <tr><td class="cell_0">
          <p>Question
            <select data-x="1" name="ans0">
              <option value="0"></option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </p>
          <p>
            <b>1)</b><script>ShowPictureQ('../../docs/a one.jpg')</script>
            <b>2)</b><script>ShowPictureQ2('../../docs/full (2).jpg','../../docs/thumb (2).jpg',120,90)</script>
            <script>
              ShowPictureQ('docs/three.jpg');
              ShowPictureQ('docs/four.jpg');
            </script>
          </p>
        </td></tr>
        <tr><td class="varinats-block">
          <label><input value="1" type="radio" name="r"> Variant</label>
        </td></tr>
        <tr><td class="submit-block"></td></tr>
        <tr><td>Тип ответа:</td><td>Choice</td></tr>
        <tr><td>КЭС:</td><td class="param-row"><div>1.1 Topic</div></td></tr>
      </table>
    </form>
  </div>
`);
assert.strictEqual(page.count, 1);
assert.strictEqual(page.tasks.length, 1);
assert.strictEqual(page.tasks[0].number, 'A1B2');
assert.strictEqual(page.tasks[0].guid, 'GUID123');
assert.strictEqual(page.tasks[0].answerForm.kind, 'selects');
assert.deepStrictEqual(page.tasks[0].answerForm.selects[0].values, ['2', '1']);
assert.strictEqual(page.tasks[0].answerType, 'Choice');
assert.deepStrictEqual(page.tasks[0].kes, ['1.1 Topic']);
assert.deepStrictEqual(page.tasks[0].images, [
  'docs/a one.jpg',
  'docs/full (2).jpg',
  'docs/thumb (2).jpg',
  'docs/three.jpg',
  'docs/four.jpg',
]);
assert.strictEqual((page.tasks[0].questionHtml.match(/class="fipi-img"/g) || []).length, 4);
assert.match(page.tasks[0].questionHtml, /p=docs%2Fthumb%20\(2\)\.jpg/);
assert.doesNotMatch(page.tasks[0].questionHtml, /<\/td>|<\/tr>|<tr\b/i);
assert.doesNotMatch(page.tasks[0].variantsHtml, /<\/td>|<\/tr>|<tr\b/i);

const social = parser.parseTasksPage(`
  setQCount(1)
  <div id="qSOC1" class="qblock">
    <form>
      <input name="guid" value="SOCGUID">
      <table>
        <tr><td class="cell_0">
          <p>Выберите верные суждения и запишите цифры.</p>
        </td></tr>
        <tr><td class="varinats-block">
          <p><input name="test0" value="1"><b>1)</b> Первое суждение.</p>
          <p><input name="test1" value="1"><b>2)</b> Второе суждение.</p>
        </td></tr>
        <tr><td class="submit-block"></td></tr>
      </table>
      <table>
        <tr><td>СВОЙСТВА ЗАДАНИЯ</td></tr>
        <tr><td>КЭС:</td><td class="param-row"><div>1.1 Общество</div></td></tr>
      </table>
    </form>
  </div>
`);
assert.strictEqual(social.tasks[0].variantsHtml.includes('Первое суждение'), true);
assert.strictEqual(social.tasks[0].elements.length, 2);
assert.deepStrictEqual(social.tasks[0].elements.map((x) => x.text), ['Первое суждение.', 'Второе суждение.']);
assert.strictEqual(social.tasks[0].elements.some((x) => /КЭС|СВОЙСТВА/.test(x.text)), false);

console.log('parser selftest ok');

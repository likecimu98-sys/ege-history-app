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

const grouped = parser.parseTasksPage(`
  setQCount(2)
  <div class="group-material">
    <p>Прочтите отрывок из исторического источника. Это общий текст для двух заданий, который должен быть сохранён вместе с группой.</p>
    <script>ShowPictureZ('../../docs/group-map.jpg')</script>
    <img src="docs/group-map-2.png" alt="map">
  </div>
  <div id="qGR1" class="qblock">
    <span title="Задание 1 в GROUP42" class="badge number-in-group">1</span>
    <form><input name="guid" value="G1"><table>
      <tr><td class="cell_0">Первый вопрос по общему материалу.</td></tr>
      <tr><td>Тип ответа:</td><td>Краткий ответ</td></tr>
    </table></form>
  </div>
  <div id="qGR2" class="qblock">
    <span class="number-in-group badge" title="Задание 2 в GROUP42">2</span>
    <form><input name="guid" value="G2"><table>
      <tr><td class="cell_0">Второй вопрос по общему материалу.</td></tr>
      <tr><td>Тип ответа:</td><td>Краткий ответ</td></tr>
    </table></form>
  </div>
`);
assert.strictEqual(grouped.tasks[0].groupId, 'GROUP42');
assert.strictEqual(grouped.tasks[0].groupOrder, 1);
assert.match(grouped.tasks[0].stimulusText, /общий текст для двух заданий/);
assert.deepStrictEqual(grouped.tasks[0].stimulusImages, ['docs/group-map.jpg', 'docs/group-map-2.png']);
assert.match(grouped.tasks[0].stimulusHtml, /class="fipi-img"/);
assert.doesNotMatch(grouped.tasks[0].questionText, /общий текст/);
assert.strictEqual(grouped.tasks[1].groupOrder, 2);

const explicitStimulus = parser.extractExplicitGroupStimulus(`
  <div class="qblock"><div class="cell_0">Вопрос группы</div></div>
  <section id="zGROUP42" class="zblock">
    <blockquote>Прочтите исторический документ. Этот материал расположен после вопросов в служебном ответе ФИПИ.</blockquote>
    <script>ShowPictureZ('docs/explicit-map.png')</script>
  </section>
`, 'ege', 'GROUP42');
assert.match(explicitStimulus.text, /материал расположен после вопросов/);
assert.deepStrictEqual(explicitStimulus.images, ['docs/explicit-map.png']);

const prefixedMapStimulus = parser.extractExplicitGroupStimulus(`
  <section id="zMAPGROUP" class="zblock">
    <p>Рассмотрите историческую карту-схему и выполните задания к общему материалу.</p>
    <script>
      var files_abs_location='../../docs/MAPGROUP/';
      ShowPicture('map main.jpg');
    </script>
    <script>ShowPictureZ2('map-full.png', 'map-preview.png', 800, 600)</script>
  </section>
`, 'ege', 'MAPGROUP');
assert.deepStrictEqual(prefixedMapStimulus.images, [
  'docs/MAPGROUP/map main.jpg',
  'docs/MAPGROUP/map-full.png',
  'docs/MAPGROUP/map-preview.png',
]);
assert.match(prefixedMapStimulus.html, /p=docs%2FMAPGROUP%2Fmap%20main\.jpg/);
assert.match(prefixedMapStimulus.html, /p=docs%2FMAPGROUP%2Fmap-preview\.png/);

const anonymousGroupMaterial = parser.parseTasksPage(`
  setQCount(2)
  <div class="qblock">
    <script>var files_abs_location = '../../docs/ANONMAP/';</script>
    <table><tr><td class="cell_0">
      <script>ShowPicture('scheme.jpg')</script>
    </td></tr></table>
  </div>
  <div class="group-meta"><div class="number-in-group" title="Задание 0 в AN0A01">0</div></div>
  <div id="qAN1" class="qblock">
    <div class="number-in-group" title="Задание 1 в AN0A01">1</div>
    <table><tr><td class="cell_0">Первый вопрос по карте.</td></tr></table>
  </div>
  <div id="qAN2" class="qblock">
    <div class="number-in-group" title="Задание 2 в AN0A01">2</div>
    <table><tr><td class="cell_0">Второй вопрос по карте.</td></tr></table>
  </div>
`, 'ege');
assert.strictEqual(anonymousGroupMaterial.tasks.length, 2);
assert.deepStrictEqual(anonymousGroupMaterial.tasks[0].stimulusImages, ['docs/ANONMAP/scheme.jpg']);
assert.match(anonymousGroupMaterial.tasks[0].stimulusHtml, /p=docs%2FANONMAP%2Fscheme\.jpg/);
assert.deepStrictEqual(anonymousGroupMaterial.tasks[1].stimulusImages, ['docs/ANONMAP/scheme.jpg']);

const loadingStimulus = parser.extractExplicitGroupStimulus(`
  <section id="zLOADING" class="zblock">
    <img src="img/loading_spinner.gif">Загрузка заданий
  </section>
`, 'ege', 'LOADING');
assert.strictEqual(loadingStimulus.html, '');
assert.strictEqual(loadingStimulus.text, '');
assert.deepStrictEqual(loadingStimulus.images, []);

console.log('parser selftest ok');

// Синтетические данные для демо «Контакты компании».
// 47 контактов одной компании, разные должности/телефоны/email/ответственные.
// Реальная версия читает crm.contact.list по конкретной company_id.

window.DEMO_DATA = (function () {
  var COMPANY_ID = 12345;

  // Ответственные (sales-менеджеры компании-продавца)
  var USERS = [
    { ID: '1',  NAME: 'Алексей',  LAST_NAME: 'Соколов',  ACTIVE: true },
    { ID: '2',  NAME: 'Мария',    LAST_NAME: 'Лебедева', ACTIVE: true },
    { ID: '3',  NAME: 'Дмитрий',  LAST_NAME: 'Орлов',    ACTIVE: true },
    { ID: '4',  NAME: 'Екатерина',LAST_NAME: 'Гончарова',ACTIVE: true },
    { ID: '5',  NAME: 'Кирилл',   LAST_NAME: 'Морозов',  ACTIVE: true },
    { ID: '6',  NAME: 'Анна',     LAST_NAME: 'Зайцева',  ACTIVE: true },
  ];

  // Контакты — 47 человек одной компании-клиента «ТД Магистраль»
  var FIRSTS = ['Иван','Сергей','Андрей','Михаил','Наталья','Ольга','Татьяна','Александр','Денис','Елена','Юрий','Виктор','Павел','Артём','Ирина','Светлана','Роман','Антон','Максим','Юлия','Валерия','Никита','Степан','Глеб','Вадим','Игорь','Константин','Геннадий','Зинаида','Полина'];
  var LASTS  = ['Петров','Иванов','Сидоров','Козлов','Новиков','Волков','Соловьёв','Васильев','Кузнецов','Попов','Семёнов','Михайлов','Фёдоров','Никифоров','Ершов','Тихонов','Карпов','Бирюков','Голубев','Андреев','Беляев','Воронин','Григорьев','Дроздов','Ефимов','Жуков','Зимин','Игнатов','Калинин','Лазарев'];
  var SECONDS= ['Иванович','Петрович','Сергеевич','Андреевич','Александрович','Михайлович','Викторович','Дмитриевич','Юрьевич','Олегович','Игоревич','Романович'];
  var POSTS  = ['Генеральный директор','Коммерческий директор','Финансовый директор','Главный бухгалтер','Главный инженер','Руководитель отдела закупок','Менеджер по закупкам','Менеджер по логистике','Кладовщик','Начальник склада','Юрист','Помощник руководителя','Технолог','Инженер ПТО','Снабженец','Маркетолог','Бренд-менеджер','Специалист по тендерам','Аналитик','Кассир'];

  function pick(arr, i) { return arr[i % arr.length]; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  // Сгенерированный «телефон» вида +7 (495) ХХХ-ХХ-ХХ
  function phone(seed) {
    var x = seed * 9301 + 49297;
    var a = (x % 900) + 100;
    var b = ((x / 1000) | 0) % 90 + 10;
    var c = ((x / 100000) | 0) % 90 + 10;
    return '+7 (' + (495 + (seed % 5) * 100) + ') ' + a + '-' + pad(b, 2) + '-' + pad(c, 2);
  }

  function translit(s) {
    var map = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ы':'y','э':'e','ю':'u','я':'ya','ь':'','ъ':''};
    return s.toLowerCase().split('').map(function(c){ return map[c] !== undefined ? map[c] : c; }).join('');
  }

  // База даты — относительно «сегодня в демо»
  var TODAY = new Date('2026-04-25T12:00:00');
  function dateAgo(days) {
    var d = new Date(TODAY);
    d.setDate(d.getDate() - days);
    return d.toISOString().replace('T', ' ').slice(0, 19) + '+03:00';
  }

  var CONTACTS = [];
  for (var i = 0; i < 47; i++) {
    var firstName = pick(FIRSTS, i * 7 + 3);
    var lastName  = pick(LASTS,  i * 11 + 5);
    var second    = pick(SECONDS, i * 3 + 1);
    var post      = pick(POSTS, i);
    var assignee  = USERS[i % USERS.length];
    var emailDom  = (i % 4 === 0) ? 'magistral.ru' : (i % 4 === 1 ? 'td-magistral.com' : (i % 4 === 2 ? 'gmail.com' : 'mail.ru'));
    var email     = translit(firstName).slice(0, 1) + '.' + translit(lastName) + '@' + emailDom;
    CONTACTS.push({
      ID: String(1000 + i),
      NAME: firstName,
      LAST_NAME: lastName,
      SECOND_NAME: (i % 3 === 0) ? '' : second,
      POST: post,
      PHONE: [{ ID: '' + (5000 + i), VALUE: phone(i + 1), VALUE_TYPE: 'WORK' }],
      EMAIL: (i % 5 === 4) ? [] : [{ ID: '' + (6000 + i), VALUE: email, VALUE_TYPE: 'WORK' }],
      ASSIGNED_BY_ID: assignee.ID,
      DATE_CREATE: dateAgo(180 - i * 3),
      COMPANY_IDS: [COMPANY_ID],
      COMPANY_ID: String(COMPANY_ID),
      PHOTO: null,
    });
  }

  return {
    companyId: COMPANY_ID,
    domain: 'demo.bitrix24.ru',
    contacts: CONTACTS,
    users: USERS,
    boundContactIds: CONTACTS.map(function (c) { return c.ID; }),
  };
})();

const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('js/auth.js', 'utf8');
const authJson = JSON.stringify({ token: 'abc', user: { email: 'demo@example.com' } });

const localStorage = {
  store: {},
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  },
};

const sessionStorage = {
  store: {},
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  },
};

const context = {
  console,
  localStorage,
  sessionStorage,
  document: {
    body: {
      classList: { add() {}, remove() {} },
      appendChild() {},
      contains() {
        return false;
      },
    },
    title: 'Survey Desk',
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {},
        setAttribute() {},
        hidden: false,
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        addEventListener() {},
        replaceChildren() {},
        focus() {},
        contains() {
          return false;
        },
        value: '',
      };
    },
  },
  window: {
    location: {
      search: '?auth=' + encodeURIComponent(authJson),
      href: 'http://localhost:4173/index.html?auth=' + encodeURIComponent(authJson),
      pathname: '/index.html',
    },
    history: { replaceState() {} },
    showDash() {},
  },
};

vm.createContext(context);
vm.runInContext(code, context);
const auth = context.window.SurveyAuth.readAuth();
console.log(
  JSON.stringify({
    restored: auth && auth.user && auth.user.email,
    stored: localStorage.getItem('survey-desk-auth'),
    sessionStored: sessionStorage.getItem('survey-desk-auth'),
  })
);

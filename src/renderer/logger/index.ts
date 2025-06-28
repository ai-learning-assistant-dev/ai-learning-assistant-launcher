import log from 'electron-log/renderer';
export default function init() {
  Object.assign(console, log.functions);
  console.log('test renderer logger');
}

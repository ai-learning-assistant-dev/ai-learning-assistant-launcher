import { Exec } from '../exec';
import { isWindows } from '../exec/util';

const privateInfoRegex = [
  /** IPv4正则 */
  /((2(5[0-5]|[0-4]\d))|[0-1]?\d{1,2})(\.((2(5[0-5]|[0-4]\d))|[0-1]?\d{1,2})){3}/g,
  /** IPv6正则 */
  /\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*/g,
  /主机名:.*\r\n/g,
  /产品 ID:.*\r\n/g,
  /注册的所有人:.*\r\n/g,
  /注册的组织:.*\r\n/g,
  /登录服务器:.*\r\n/g,
  /系统区域设置:.*\r\n/g,
  /输入法区域设置:.*\r\n/g,
  /系统制造商:.*\r\n/g,
  /时区:.*\r\n/g,
  /域:.*\r\n/g,
];

// 将设备硬件信息记录在日志中，方便解决用户故障
export async function logDeviceInfo() {
  try {
    if (isWindows()) {
      const commandLine = new Exec();
      const result = await commandLine.exec('systeminfo');
      // 抹除所有敏感信息
      let info = result.stdout;
      for (const regex of privateInfoRegex) {
        info = info.replace(regex, '');
      }
      console.log(info);
    }
  } catch (error) {
    console.warn(error);
  }
  try {
    const commandLine = new Exec();
    const result = await commandLine.exec('podman', [
      'machine',
      'inspect',
      '--format',
      '"UserModeNetworking: {{.UserModeNetworking}}\\nRootful: {{.Rootful}}\\nState: {{.State}}\\nCreated: {{.Created}}"',
    ]);
    console.log('podman info');
    console.log(result.stdout);
  } catch (error) {
    console.warn(error);
  }
}

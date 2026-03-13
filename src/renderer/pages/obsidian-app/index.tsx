import { Button, List } from 'antd';
import { NavLink } from 'react-router-dom';
import './index.scss';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';
import { useObsidianVoiceService } from '../../containers/use-obsidian-voice-service';

export default function ObsidianApp() {
  const {
    isInstallObsidian,
    action: cmdAction,
  } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
  } = useConfigs();
  const {
    voiceState,
    voiceLoading,
    voiceOperation,
    installVoiceService,
    runVoiceService,
    stopVoiceService,
    refreshVoiceStatus,
  } = useObsidianVoiceService();

  return (
    <div className="obsidian-app">
      <List
        className="obsidian-app-list"
        header={
          <div className="header-container">
            <NavLink to="/hello">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
        bordered
      >
        {obsidianVaultConfig?.map((vault) => (
          <List.Item
            key={vault.id}
            actions={[
              <NavLink key="workspace" to={`/workspace-manage/${vault.id}`}>
                <Button>工作区管理</Button>
              </NavLink>,
              <NavLink key={0} to={`/obsidian-plugin/${vault.id}`}>
                <Button>插件情况</Button>
              </NavLink>,
              isInstallObsidian && (
                <Button
                  key={1}
                  onClick={() => cmdAction('start', 'obsidianApp', vault.id)}
                >
                  用阅读器打开
                </Button>
              ),
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`仓库 ${vault.name}`}
              description={vault.path}
            />
          </List.Item>
        ))}
        <List.Item
          actions={[
            !isInstallObsidian && (
              <Button
                key={0}
                onClick={() => cmdAction('install', 'obsidianApp')}
              >
                安装阅读器
              </Button>
            ),
            <Button
              key={1}
              onClick={() => configsAction('update', 'obsidianApp')}
            >
              {isInstallObsidian ? '重新定位阅读器' : '定位阅读器'}
            </Button>,
            isInstallObsidian && (
              <Button
                key={2}
                type="primary"
                onClick={() => cmdAction('start', 'obsidianApp')}
              >
                运行阅读器
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title={`阅读器主程序`}
            description={obsidianConfig?.obsidianApp?.bin}
          />
        </List.Item>
        <List.Item
          actions={[
            (voiceState === 'not_installed' || !voiceState) && (
              <Button
                key="install-voice-service"
                loading={
                  voiceLoading &&
                  voiceOperation === 'install' &&
                  voiceState === 'starting'
                }
                onClick={installVoiceService}
              >
                安装语音服务
              </Button>
            ),
            voiceState !== 'running' && (
              <Button
                key="run-voice-service"
                type="primary"
                loading={
                  voiceLoading &&
                  voiceOperation === 'run' &&
                  voiceState === 'starting'
                }
                onClick={runVoiceService}
              >
                启动语音服务
              </Button>
            ),
            (voiceState === 'running' || voiceState === 'starting') && (
              <Button
                key="stop-voice-service"
                danger
                loading={
                  voiceLoading &&
                  voiceOperation === 'stop' &&
                  voiceState === 'starting'
                }
                onClick={stopVoiceService}
              >
                停止语音服务
              </Button>
            ),
            <Button
              key="refresh-voice-service"
              loading={voiceLoading && voiceState === 'starting'}
              onClick={refreshVoiceStatus}
            >
              刷新状态
            </Button>,
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="Obsidian Voice Service"
            description={`服务状态：${voiceState || 'unknown'}（端口 8001）`}
          />
        </List.Item>
      </List>
    </div>
  );
}

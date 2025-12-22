import { createRoot } from 'react-dom/client';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import '@ant-design/v5-patch-for-react-19';
import '../app.css';

// 导入所有页面组件
import Hello from '../pages/hello';
import AiService from '../pages/ai-service';
import ObsidianApp from '../pages/obsidian-app';
import ObsidianPlugin from '../pages/obsidian-plugin';
import WorkspaceManage from '../pages/workspace-manage';
import TTSConfig from '../pages/tts-config';
import ASRConfig from '../pages/asr-config';
import LMService from '../pages/lm-service';
import ExamplePage from '../pages/example-page';
import PdfConvert from '../pages/pdf-convert';
import PdfConfig from '../pages/pdf-config';
import LLMConfig from '../pages/llm-api-config';
import VoiceRTCConfig from '../pages/voice-rtc-config';

// 获取页面名称的函数
function getPageName(): string {
  // 从环境变量获取页面名称
  // 注意：在Webpack构建过程中，__TEST_PAGE_NAME__会被替换为实际值
  // @ts-ignore
  return __TEST_PAGE_NAME__ || 'hello';
}

// 创建带完整路由的测试应用
function TestApp() {
  // 根据页面名称确定初始路由
  const pageName = getPageName();
  let initialPath = '/';
  
  // 根据页面名称设置初始路径
  switch(pageName) {
    case 'ai-service':
      initialPath = '/ai-service';
      break;
    case 'lm-service':
      initialPath = '/lm-service';
      break;
    case 'llm-api-config':
      initialPath = '/llm-api-config';
      break;
    case 'hello':
      initialPath = '/hello';
      break;
    case 'obsidian-app':
      initialPath = '/obsidian-app';
      break;
    case 'tts-config':
      initialPath = '/TTS-config';
      break;
    case 'asr-config':
      initialPath = '/ASR-config';
      break;
    case 'voice-rtc-config':
      initialPath = '/VOICE_RTC-config';
      break;
    case 'pdf-config':
      initialPath = '/PDF-config';
      break;
    case 'pdf-convert':
      initialPath = '/pdf-convert';
      break;
    case 'obsidian-plugin':
      initialPath = '/obsidian-plugin/default';
      break;
    case 'example-page':
      initialPath = '/example';
      break;
    case 'workspace-manage':
      initialPath = '/workspace-manage/default';
      break;
    default:
      initialPath = '/';
  }

  return (
    <AntdApp>
      <Router initialEntries={[initialPath]}>
        <Routes>
          <Route path="/ai-service" element={<AiService />} />
          <Route path="/lm-service" element={<LMService />} />
          <Route path="/llm-api-config" element={<LLMConfig />} />
          <Route path="/hello" element={<Hello />} />
          <Route path="/obsidian-app" element={<ObsidianApp />} />
          <Route path="/TTS-config" element={<TTSConfig />} />
          <Route path="/ASR-config" element={<ASRConfig />} />
          <Route path="/VOICE_RTC-config" element={<VoiceRTCConfig />} />
          <Route path="/PDF-config" element={<PdfConfig />} />
          <Route path="/pdf-convert" element={<PdfConvert />} />
          <Route
            path="/obsidian-plugin/:vaultId"
            element={<ObsidianPlugin />}
          />
          <Route path="/example" element={<ExamplePage />} />
          <Route path="/workspace-manage/:vaultId" element={<WorkspaceManage />} />
          <Route index element={<Hello />} />
        </Routes>
      </Router>
    </AntdApp>
  );
}

// 页面挂载点
const container = document.createElement('div');
container.id = 'root';
document.body.appendChild(container);

// 渲染应用
const root = createRoot(container);
root.render(<TestApp />);
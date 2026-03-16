import { MemoryRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import '@ant-design/v5-patch-for-react-19';
import Hello from './pages/hello';
import './app.css';
import AiService from './pages/ai-service';
import ObsidianApp from './pages/obsidian-app';
import { App as AntdApp } from 'antd';
import ObsidianPlugin from './pages/obsidian-plugin';
import WorkspaceManage from './pages/workspace-manage';
import TTSConfig from './pages/tts-config';
import ASRConfig from './pages/asr-config';
import LMService from './pages/lm-service';
import ExamplePage from './pages/example-page';
import PdfConvert from './pages/pdf-convert';
import PdfConfig from './pages/pdf-config';
import LLMConfig from './pages/llm-api-config';
import VoiceRTCConfig from './pages/voice-rtc-config';
import WelcomeModal from './pages/welcome/WelcomeModal';
import JointBuild from './pages/joint-build';
import { useEffect } from 'react';

// 托盘菜单导航监听组件
function TrayNavigationHandler() {
  const navigate = useNavigate();
  
  useEffect(() => {
    // 监听托盘菜单的导航事件
    const unsubscribeNavigate = window.mainHandle.onNavigateTo((route: string) => {
      navigate(route);
    });
    
    // 监听共建计划状态变化事件
    const unsubscribeStatus = window.mainHandle.onJointBuildStatusChanged((enabled: boolean) => {
      // 更新 localStorage
      localStorage.setItem('joint_build_master_switch', String(enabled));
      // 触发页面刷新或状态更新
      window.dispatchEvent(new CustomEvent('joint-build-status-changed', { detail: enabled }));
    });
    
    return () => {
      unsubscribeNavigate();
      unsubscribeStatus();
    };
  }, [navigate]);
  
  return null;
}
import P2PTest from './pages/p2p-test';
import NativeAiService from './pages/native-ai-service';

export default function App() {
  return (
    <AntdApp>
      <WelcomeModal />
      <Router>
        <TrayNavigationHandler />
        <Routes>
          <Route path="/joint-build" element={<JointBuild />} />
          <Route path="/ai-service" element={<AiService />} />
          <Route path="/native-ai-service" element={<NativeAiService />} />
          <Route path="/lm-service" element={<LMService />} />
          <Route path="/llm-api-config" element={<LLMConfig />} />
          <Route path="/hello" element={<Hello />} />
          <Route path="/obsidian-app" element={<ObsidianApp />} />
          <Route path="/TTS-config" element={<TTSConfig />} />
          <Route path="/ASR-config" element={<ASRConfig />} />
          <Route path="/VOICE_RTC-config" element={<VoiceRTCConfig />} />
          <Route path="/PDF-config" element={<PdfConfig />} />
          <Route path="/pdf-convert" element={<PdfConvert />} />
          <Route path="/p2p-test" element={<P2PTest />} />
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

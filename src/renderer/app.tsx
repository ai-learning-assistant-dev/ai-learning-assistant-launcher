import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <AntdApp>
      <Router>
        <Routes>
          <Route path="/ai-service" element={<AiService />} />
          <Route path="/lm-service" element={<LMService />} />
          <Route path="/hello" element={<Hello />} />
          <Route path="/obsidian-app" element={<ObsidianApp />} />
          <Route path="/TTS-config" element={<TTSConfig />} />
          <Route path="/ASR-config" element={<ASRConfig />} />
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

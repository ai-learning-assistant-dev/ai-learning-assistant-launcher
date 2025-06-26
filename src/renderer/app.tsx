import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import '@ant-design/v5-patch-for-react-19';
import Hello from './pages/hello';
import './app.css';
import AiService from './pages/ai-service';
import ObsidianApp from './pages/obsidian-app';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/ai-service" element={<AiService />} />
        <Route path="/hello" element={<Hello />} />
        <Route path="/obsidian-app" element={<ObsidianApp />} />
        <Route path="/obsidian-plugin" element={<ObsidianApp />} />
        <Route index element={<Hello />} />
      </Routes>
    </Router>
  );
}

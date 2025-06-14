import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import Hello from '../pages/hello';
import './App.css';
import AiService from '../pages/ai-service';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/ai-service" element={<AiService />} />
        <Route path="/hello" element={<Hello />} />
        <Route path="/" element={<Hello />} />
      </Routes>
    </Router>
  );
}

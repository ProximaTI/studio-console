import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Um erro de render num componente não deve derrubar a console inteira.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="page">
          <div className="error">Erro na interface: {String(this.state.err?.message || this.state.err)}</div>
          <button style={{ marginTop: 12 }} onClick={() => this.setState({ err: null })}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import ProjectEditor from './pages/ProjectEditor';
import ProjectData from './pages/ProjectData';
import Connections from './pages/Connections';
import NewReport from './wizard/ReportAgent';
import ReportView, { ReportsList } from './pages/Reports';
import Settings from './pages/Settings';
import { jget } from './api';
import { applyTheme } from './theme';
import { DialogHost } from './components/dialogs';

export default function App() {
  const [settings, setSettings] = useState<any>(null);
  useEffect(() => {
    jget('/settings').then((s) => {
      setSettings(s);
      applyTheme(s.theme);
    });
  }, []);
  return (
    <div className="layout">
      <Sidebar org={settings?.organization?.name} />
      <main className="content">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/projects/:project" element={<ProjectEditor />} />
          <Route path="/projects/:project/data" element={<ProjectData />} />
          <Route path="/projects/:project/new-report" element={<NewReport />} />
          <Route path="/projects/:project/reports" element={<ReportsList />} />
          <Route path="/projects/:project/reports/:slug" element={<ReportView />} />
          <Route
            path="/settings"
            element={
              <Settings
                onSaved={(s) => {
                  setSettings(s);
                  applyTheme(s.theme);
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <DialogHost />
    </div>
  );
}

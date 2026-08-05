import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from './api/apiClient.js';
import { AppContext } from './AppContext.jsx';
import ChooseModeScreen from './screens/ChooseModeScreen.jsx';
import HeadOfficeSetupScreen from './screens/HeadOfficeSetupScreen.jsx';
import BranchOfficeSetupScreen from './screens/BranchOfficeSetupScreen.jsx';
import LoginScreen from './screens/LoginScreen.jsx';
import AppShell from './screens/AppShell.jsx';
import SplashScreen from './components/SplashScreen.jsx';

// Splash stays up at least this long even if boot resolves instantly, so
// it reads as an intentional cinematic intro rather than a flash.
const SPLASH_MIN_MS = 2200;

// Views worth restoring after a refresh. caseDetail/settings are excluded —
// caseDetail needs a selectedProbationerId we don't persist, and settings is
// a Ctrl+S overlay rather than a place users expect to land back on.
const RESTORABLE_VIEWS = ['dashboard', 'signatureAttendance', 'manageUsers', 'psir', 'recordsCheck'];
const APP_VIEW_STORAGE_KEY = 'appView';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [splashClosing, setSplashClosing] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [screen, setScreen] = useState('chooseMode'); // chooseMode | hoSetup | boSetup | login | app
  const [hoInitialStep, setHoInitialStep] = useState(0); // 0 = MySQL connection, 1 = create admin
  const [enums, setEnums] = useState({ STAGES: [], STATUSES: [], ROLES: [] });
  const [settings, setSettings] = useState({});
  const [user, setUser] = useState(null);
  const [appView, setAppView] = useState('dashboard'); // dashboard | caseDetail | signatureAttendance | manageUsers | settings
  const [selectedProbationerId, setSelectedProbationerId] = useState(null);

  const refreshSettings = useCallback(async () => {
    const s = await window.api.getSettings();
    setSettings(s);
    return s;
  }, []);

  const openSettings = useCallback(() => {
    setScreen('app');
    setAppView('settings');
  }, []);

  const goDashboard = useCallback(() => {
    setAppView('dashboard');
    setScreen('app');
  }, []);

  const logout = useCallback(() => {
    ApiClient.logout();
    localStorage.removeItem(APP_VIEW_STORAGE_KEY);
    setUser(null);
    setScreen('login');
  }, []);

  const openCase = useCallback((id) => {
    setSelectedProbationerId(id);
    setAppView('caseDetail');
  }, []);

  const enterApp = useCallback((loggedInUser) => {
    setUser(loggedInUser);
    setAppView('dashboard');
    setScreen('app');
  }, []);

  // Choose Mode → Head Office always starts the wizard fresh at step 0,
  // regardless of how hoSetup was last left (e.g. from a resumed
  // needsAdmin jump-to-step-1 on a previous boot).
  const goHeadOfficeSetup = useCallback(() => {
    setHoInitialStep(0);
    setScreen('hoSetup');
  }, []);

  useEffect(() => {
    async function boot() {
      const enumsData = await window.api.getEnums();
      setEnums(enumsData);
      const s = await refreshSettings();

      if (!s.mode) {
        setScreen('chooseMode');
        setBooting(false);
        return;
      }
      if (s.mode === 'head-office' && (!s.mysqlConfig || !s.mysqlConfig.user)) {
        setHoInitialStep(0);
        setScreen('hoSetup');
        setBooting(false);
        return;
      }
      if (s.mode === 'branch-office' && !s.pinnedCertFingerprint) {
        setScreen('boSetup');
        setBooting(false);
        return;
      }

      // Resume a session carried over from before a page reload — re-validate
      // against the server rather than trusting a possibly-stale token.
      if (ApiClient.isLoggedIn()) {
        try {
          const { user: restoredUser } = await ApiClient.get('/auth/me');
          setUser(restoredUser);
          const savedView = localStorage.getItem(APP_VIEW_STORAGE_KEY);
          const canRestoreManageUsers = savedView !== 'manageUsers' || restoredUser.role === 'admin';
          setAppView(RESTORABLE_VIEWS.includes(savedView) && canRestoreManageUsers ? savedView : 'dashboard');
          setScreen('app');
          setBooting(false);
          return;
        } catch (err) {
          ApiClient.logout();
        }
      }

      if (s.mode === 'head-office') {
        try {
          const status = await ApiClient.get('/auth/bootstrap-status');
          if (status.needsAdmin) {
            setHoInitialStep(1);
            setScreen('hoSetup');
          } else {
            setScreen('login');
          }
        } catch (err) {
          setHoInitialStep(0);
          setScreen('hoSetup');
        }
      } else {
        setScreen('login');
      }
      setBooting(false);
    }

    boot();
  }, [refreshSettings]);

  useEffect(() => {
    if (screen === 'app' && RESTORABLE_VIEWS.includes(appView)) {
      localStorage.setItem(APP_VIEW_STORAGE_KEY, appView);
    }
  }, [screen, appView]);

  useEffect(() => {
    const timer = setTimeout(() => setSplashElapsed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (booting || !splashElapsed) return undefined;
    setSplashClosing(true);
    const timer = setTimeout(() => setShowSplash(false), 700);
    return () => clearTimeout(timer);
  }, [booting, splashElapsed]);

  // Ctrl+S / Cmd+S opens Settings from anywhere — no visible menu item or
  // icon, by design (see conversation history on this).
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSettings();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSettings]);

  const ctxValue = {
    enums,
    settings,
    refreshSettings,
    user,
    appView,
    setAppView,
    selectedProbationerId,
    openSettings,
    goDashboard,
    goHeadOfficeSetup,
    logout,
    openCase,
    enterApp,
    setScreen,
    hoInitialStep,
  };

  return (
    <>
      {!booting && (
        <AppContext.Provider value={ctxValue}>
          {screen === 'chooseMode' && <ChooseModeScreen />}
          {screen === 'hoSetup' && <HeadOfficeSetupScreen />}
          {screen === 'boSetup' && <BranchOfficeSetupScreen />}
          {screen === 'login' && <LoginScreen />}
          {screen === 'app' && <AppShell />}
        </AppContext.Provider>
      )}
      {showSplash && <SplashScreen closing={splashClosing} />}
    </>
  );
}

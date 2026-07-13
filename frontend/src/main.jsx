import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { store } from './app/store';
import App from './App';
import ThemeProviderWrapper from './app/ThemeProviderWrapper';

import './index.css';

// Global defaults tuned for a socket-driven UI: we never poll on focus
// or reconnect, and treat data as fresh for 60 s so navigating between
// pages does not re-fire the same request. Realtime cache invalidations
// still make the UI update immediately when the server has news.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
      staleTime: 60_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProviderWrapper>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <App />
            <ToastContainer position="top-right" theme="colored" autoClose={3000} />
          </BrowserRouter>
        </ThemeProviderWrapper>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);

import { createSlice } from '@reduxjs/toolkit';

const persisted = JSON.parse(localStorage.getItem('tla_auth') || 'null') || {
  user: null,
  accessToken: null,
  refreshToken: null,
};

const persist = (state) => {
  localStorage.setItem(
    'tla_auth',
    JSON.stringify({
      user: state.user,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
    })
  );
};

const slice = createSlice({
  name: 'auth',
  initialState: persisted,
  reducers: {
    setCredentials: (state, action) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      persist(state);
    },
    setTokens: (state, action) => {
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      persist(state);
    },
    setUser: (state, action) => {
      state.user = action.payload;
      persist(state);
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      localStorage.removeItem('tla_auth');
    },
  },
});

export const { setCredentials, setTokens, setUser, logout } = slice.actions;
export default slice.reducer;

export const selectIsAuthed = (s) => Boolean(s.auth.accessToken && s.auth.user);
export const selectRole = (s) => s.auth.user?.role;

import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../api/client";

export const fetchAccount = createAsyncThunk(
  "account/fetch",
  async (_, { rejectWithValue }) => {
    try {
      return await api.getAccount();
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

const accountSlice = createSlice({
  name: "account",
  initialState: {
    data: null, // { name, accountNumber, balance, currency, lastLogin }
    status: "idle",
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccount.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchAccount.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.data = action.payload.accounts?.[0] || null;;
      })
      .addCase(fetchAccount.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Could not load account.";
      });
  },
});

export default accountSlice.reducer;

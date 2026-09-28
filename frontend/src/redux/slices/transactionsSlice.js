import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../api/client";

export const fetchTransactions = createAsyncThunk(
  "transactions/fetch",
  async (params = {}, { rejectWithValue }) => {
    try {
      return await api.getTransactions(params);
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const createTransaction = createAsyncThunk(
  "transactions/create",
  async (payload, { rejectWithValue }) => {
    try {
      return await api.createTransaction(payload);
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

const transactionsSlice = createSlice({
  name: "transactions",
  initialState: {
    items: [],
    total: 0,
    status: "idle",
    createStatus: "idle",
    error: null,
  },
  reducers: {
    resetCreateStatus(state) {
      state.createStatus = "idle";
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactions.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.items = action.payload.items || [];
        state.total = action.payload.total || 0;
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Could not load transactions.";
      })
      .addCase(createTransaction.pending, (state) => {
        state.createStatus = "loading";
      })
      .addCase(createTransaction.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        const transaction = action.payload.transaction;
        state.items = [transaction, ...state.items];
      })
      .addCase(createTransaction.rejected, (state, action) => {
        state.createStatus = "failed";
        state.error = action.payload || "Could not create transaction.";
      });
  },
});

export const { resetCreateStatus } = transactionsSlice.actions;
export default transactionsSlice.reducer;

import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Tabs,
  Tab
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Add as AddIcon } from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';

function Borrows() {
  const [borrows, setBorrows] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [tabValue, setTabValue] = useState(0);
  const { user } = useAuth();

  const columns = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'title', headerName: 'Book Title', width: 200 },
    { field: 'author', headerName: 'Author', width: 150 },
    { field: 'borrow_date', headerName: 'Borrow Date', width: 150 },
    { field: 'due_date', headerName: 'Due Date', width: 150 },
    { field: 'status', headerName: 'Status', width: 100 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 130,
      renderCell: (params) => (
        params.row.status === 'borrowed' && (
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={() => handleReturn(params.row.id)}
          >
            Return
          </Button>
        )
      )
    }
  ];

  useEffect(() => {
    fetchBorrows();
  }, [tabValue]);

  const fetchBorrows = async () => {
    try {
      let response;
      if (tabValue === 0) {
        response = await axios.get(`http://localhost:3000/api/borrows/user/${user.id}`);
      } else if (tabValue === 1) {
        response = await axios.get('http://localhost:3000/api/borrows/active');
      } else {
        response = await axios.get('http://localhost:3000/api/borrows/overdue');
      }
      setBorrows(response.data);
    } catch (error) {
      toast.error('Error fetching borrows');
    }
  };

  const handleOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedBook(null);
  };

  const handleBorrow = async () => {
    try {
      await axios.post('http://localhost:3000/api/borrows/borrow', {
        bookId: selectedBook.id,
        userId: user.id
      });
      toast.success('Book borrowed successfully');
      handleClose();
      fetchBorrows();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error borrowing book');
    }
  };

  const handleReturn = async (borrowId) => {
    try {
      await axios.post(`http://localhost:3000/api/borrows/return/${borrowId}`);
      toast.success('Book returned successfully');
      fetchBorrows();
    } catch (error) {
      toast.error('Error returning book');
    }
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h4" component="h1">
            Borrow Management
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleOpen}
          >
            Borrow Book
          </Button>
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label="My Borrows" />
            <Tab label="Active Borrows" />
            <Tab label="Overdue Books" />
          </Tabs>
        </Box>

        <DataGrid
          rows={borrows}
          columns={columns}
          pageSize={10}
          rowsPerPageOptions={[10]}
          autoHeight
          disableSelectionOnClick
        />

        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
          <DialogTitle>Borrow a Book</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Book ID"
              value={selectedBook?.id || ''}
              onChange={(e) => setSelectedBook({ id: e.target.value })}
              margin="normal"
              required
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button onClick={handleBorrow} variant="contained" color="primary">
              Borrow
            </Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Container>
  );
}

export default Borrows; 
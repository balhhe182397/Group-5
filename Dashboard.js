import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  CardHeader
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

function Dashboard() {
  const [stats, setStats] = useState({
    totalBooks: 0,
    totalBorrows: 0,
    overdueBooks: 0
  });
  const [recentBorrows, setRecentBorrows] = useState([]);
  const { user } = useAuth();

  const columns = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'title', headerName: 'Book Title', width: 200 },
    { field: 'borrow_date', headerName: 'Borrow Date', width: 150 },
    { field: 'due_date', headerName: 'Due Date', width: 150 },
    { field: 'status', headerName: 'Status', width: 100 }
  ];

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [booksResponse, borrowsResponse, overdueResponse] = await Promise.all([
        axios.get('http://localhost:3000/api/books'),
        axios.get('http://localhost:3000/api/borrows/active'),
        axios.get('http://localhost:3000/api/borrows/overdue')
      ]);

      setStats({
        totalBooks: booksResponse.data.length,
        totalBorrows: borrowsResponse.data.length,
        overdueBooks: overdueResponse.data.length
      });

      setRecentBorrows(borrowsResponse.data.slice(0, 5));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Grid container spacing={3}>
        {/* Welcome Card */}
        <Grid item xs={12}>
          <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
            <Typography variant="h4" gutterBottom>
              Welcome, {user?.username}!
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Here's an overview of your library management system
            </Typography>
          </Paper>
        </Grid>

        {/* Stats Cards */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Books
              </Typography>
              <Typography variant="h3">
                {stats.totalBooks}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Active Borrows
              </Typography>
              <Typography variant="h3">
                {stats.totalBorrows}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Overdue Books
              </Typography>
              <Typography variant="h3" color="error">
                {stats.overdueBooks}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Borrows */}
        <Grid item xs={12}>
          <Paper elevation={3} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Recent Borrows
            </Typography>
            <DataGrid
              rows={recentBorrows}
              columns={columns}
              pageSize={5}
              rowsPerPageOptions={[5]}
              autoHeight
              disableSelectionOnClick
            />
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}

export default Dashboard; 
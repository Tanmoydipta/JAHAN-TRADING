package com.jahantrading.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jahantrading.app.ui.components.KpiCard
import com.jahantrading.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToEntry: (String) -> Unit,
    onNavigateToReport: (String) -> Unit,
    onLogout: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showDrawer by remember { mutableStateOf(false) }

    LaunchedEffect(state.user) {
        if (state.user == null) onLogout()
    }

    val config = state.config
    val perms = state.permissions

    if (showDrawer && config != null) {
        ModalNavigationDrawer(
            drawerState = rememberDrawerState(DrawerValue.Open),
            drawerContent = {
                ModalDrawerSheet(drawerContainerColor = BgCard) {
                    Text(
                        "ENTRY POINTS",
                        modifier = Modifier.padding(16.dp, 20.dp, 16.dp, 8.dp),
                        style = MaterialTheme.typography.labelSmall
                    )
                    config.entry_points.forEach { ep ->
                        val allowed = perms?.allowed_entry_points
                        if (allowed != null && (allowed.contains("*") || allowed.contains(ep.id))) {
                            NavigationDrawerItem(
                                label = { Text(ep.title, fontSize = 13.sp) },
                                selected = false,
                                onClick = { showDrawer = false; onNavigateToEntry(ep.id) },
                                modifier = Modifier.padding(horizontal = 8.dp)
                            )
                        }
                    }

                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp), color = BorderColor)

                    Text(
                        "REPORTS",
                        modifier = Modifier.padding(16.dp, 8.dp, 16.dp, 8.dp),
                        style = MaterialTheme.typography.labelSmall
                    )
                    config.report_points.forEach { rp ->
                        val allowed = perms?.allowed_report_points
                        if (allowed != null && (allowed.contains("*") || allowed.contains(rp.id))) {
                            NavigationDrawerItem(
                                label = { Text(rp.title, fontSize = 13.sp) },
                                selected = false,
                                onClick = { showDrawer = false; onNavigateToReport(rp.id) },
                                modifier = Modifier.padding(horizontal = 8.dp)
                            )
                        }
                    }
                }
            },
            content = { DashboardContent(state, viewModel, { showDrawer = !showDrawer }, onNavigateToEntry, onLogout) }
        )
    } else {
        DashboardContent(state, viewModel, { showDrawer = !showDrawer }, onNavigateToEntry, onLogout)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DashboardContent(
    state: DashboardUiState,
    viewModel: DashboardViewModel,
    onMenuClick: () -> Unit,
    onNavigateToEntry: (String) -> Unit,
    onLogout: () -> Unit
) {
    val fmt = { n: Double -> "${state.dashboard?.currency ?: "BDT"} ${"%.2f".format(n)}" }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Dashboard", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            state.user?.full_name ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onMenuClick) { Icon(Icons.Default.Menu, "Menu") }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) { Icon(Icons.Default.Refresh, "Refresh") }
                    IconButton(onClick = { viewModel.logout(); onLogout() }) {
                        Icon(Icons.AutoMirrored.Filled.Logout, "Logout", tint = AccentRose)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BgDark)
            )
        },
        containerColor = BgDark,
        floatingActionButton = {
            FloatingActionButton(
                onClick = { onNavigateToEntry("new_sale") },
                containerColor = Primary
            ) {
                Icon(Icons.Default.Add, "New Sale")
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isLoading,
            onRefresh = viewModel::refresh,
            modifier = Modifier.padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (state.error != null) {
                    item {
                        Text(
                            "Error: ${state.error}",
                            color = AccentRose,
                            modifier = Modifier.padding(8.dp)
                        )
                    }
                }

                val d = state.dashboard
                if (d != null) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KpiCard("Total Sales", fmt(d.total_revenue), "${d.total_sales_count} Chalans", AccentEmerald, Modifier.weight(1f))
                            KpiCard("Purchases", fmt(d.total_purchases), "Stock procurement", AccentCyan, Modifier.weight(1f))
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KpiCard("Stock Value", fmt(d.inventory_valuation), "Current asset", Primary, Modifier.weight(1f))
                            KpiCard("Low Stock", "${d.low_stock_count} Items", "Qty <= 5", AccentRose, Modifier.weight(1f))
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KpiCard("Receivable", fmt(d.total_receivable), "From customers", AccentAmber, Modifier.weight(1f))
                            KpiCard("Payable", fmt(d.total_payable), "To suppliers", AccentRose, Modifier.weight(1f))
                        }
                    }

                    // Recent Sales
                    item {
                        Text(
                            "Recent Sales",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                    if (d.recent_sales.isEmpty()) {
                        item {
                            Text("No sales recorded yet.", color = TextMuted, modifier = Modifier.padding(16.dp))
                        }
                    }
                    items(d.recent_sales) { sale ->
                        RecentSaleRow(sale.chalan_no, sale.sale_date, sale.buyer_name,
                            sale.product_type, sale.sale_total_price, sale.due ?: 0.0,
                            d.currency)
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentSaleRow(
    chalan: String, date: String, buyer: String,
    product: String, total: Double, due: Double, currency: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(BgCard)
            .padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("#$chalan", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text("$buyer — $product", fontSize = 12.sp, color = TextMuted)
            Text(date, fontSize = 11.sp, color = TextDim)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text("$currency ${"%.2f".format(total)}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (due > 0) {
                Text("Due: ${"%.2f".format(due)}", fontSize = 11.sp, color = AccentAmber)
            } else {
                Text("Cleared", fontSize = 11.sp, color = AccentEmerald)
            }
        }
    }
}

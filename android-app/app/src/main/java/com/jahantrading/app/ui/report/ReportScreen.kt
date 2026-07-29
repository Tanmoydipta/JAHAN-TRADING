package com.jahantrading.app.ui.report

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jahantrading.app.ui.components.DataTable
import com.jahantrading.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportScreen(
    reportId: String,
    onBack: () -> Unit,
    viewModel: ReportViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showFilters by remember { mutableStateOf(false) }

    LaunchedEffect(reportId) { viewModel.loadReport(reportId) }

    val reportDef = state.reportDef

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(reportDef?.title ?: "Report", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("${state.rows.size} records", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                actions = {
                    if (reportDef?.supports_period == true || reportDef?.supports_customer_filter == true) {
                        IconButton(onClick = { showFilters = !showFilters }) {
                            Icon(Icons.Default.FilterAlt, "Filter", tint = if (showFilters) Primary else TextMuted)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BgDark)
            )
        },
        containerColor = BgDark
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {

            // Search bar
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = viewModel::updateSearch,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search...", color = TextDim) },
                leadingIcon = { Icon(Icons.Default.Search, null, tint = TextMuted) },
                singleLine = true,
                shape = RoundedCornerShape(10.dp)
            )

            // Collapsible filter panel
            if (showFilters) {
                FilterPanel(state, viewModel, reportDef)
            }

            // Error
            if (state.error != null) {
                Text(state.error!!, color = AccentRose, modifier = Modifier.padding(16.dp))
            }

            // Loading
            if (state.isLoading) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else {
                // Data table
                DataTable(
                    columns = state.columns,
                    keys = state.keys,
                    rows = viewModel.filteredRows,
                    modifier = Modifier.weight(1f).padding(horizontal = 16.dp)
                )

                // Summary bar
                if (state.summaryColumn != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgCard)
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Records: ${viewModel.filteredRows.size}", color = TextMuted, fontSize = 13.sp)
                        Text(
                            "${state.summaryColumn!!.replace("_", " ").uppercase()}: BDT ${"%.2f".format(state.summaryTotal)}",
                            fontWeight = FontWeight.Bold,
                            color = AccentEmerald,
                            fontSize = 15.sp
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterPanel(
    state: ReportUiState,
    viewModel: ReportViewModel,
    reportDef: com.jahantrading.app.data.remote.dto.ReportPointDef?
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(BgCard)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (reportDef?.supports_period == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.dateFrom,
                    onValueChange = viewModel::updateDateFrom,
                    label = { Text("From (YYYY-MM-DD)") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
                OutlinedTextField(
                    value = state.dateTo,
                    onValueChange = viewModel::updateDateTo,
                    label = { Text("To (YYYY-MM-DD)") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
            }
        }

        if (reportDef?.supports_customer_filter == true) {
            OutlinedTextField(
                value = state.customerFilter,
                onValueChange = viewModel::updateCustomerFilter,
                label = { Text("Customer Name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        }

        if (reportDef?.supports_txn_type_filter == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Sales", "Purchase", "Transport").forEach { type ->
                    FilterChip(
                        selected = state.txnType == type,
                        onClick = { viewModel.updateTxnType(type) },
                        label = { Text(type, fontSize = 12.sp) }
                    )
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = viewModel::applyFilters,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Primary)
            ) { Text("Apply") }
            TextButton(onClick = viewModel::clearFilters) { Text("Reset") }
        }
    }
}

package com.jahantrading.app.ui.entry

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jahantrading.app.ui.components.DynamicFormField
import com.jahantrading.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EntryScreen(
    entryId: String,
    onBack: () -> Unit,
    viewModel: EntryViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(entryId) { viewModel.loadEntry(entryId) }

    val entryDef = state.entryDef

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(entryDef?.title ?: "Entry", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BgDark)
            )
        },
        containerColor = BgDark
    ) { padding ->
        if (entryDef == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Primary)
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Visible fields based on show_if conditions
            val visibleFields = entryDef.fields.filter { field ->
                val cond = field.show_if ?: return@filter true
                state.fieldValues[cond.field] == cond.value
            }

            items(visibleFields, key = { it.name }) { field ->
                val customerType = field.customer_type_filter
                DynamicFormField(
                    field = field,
                    value = state.fieldValues[field.name] ?: "",
                    onValueChange = { value ->
                        viewModel.updateField(field.name, value)
                        if (field.type == "select" && field.name == "movement_type") {
                            viewModel.loadInvoiceRefs(value)
                        }
                    },
                    products = state.products,
                    inventory = state.inventory,
                    customers = if (customerType != null) state.customers[customerType] ?: emptyList() else emptyList(),
                    invoiceRefs = state.invoiceRefs,
                    onProductSelected = { viewModel.onProductSelected(it) },
                    onInventorySelected = { viewModel.onInventorySelected(it) },
                    onCustomerSelected = { viewModel.onCustomerSelected(it, field.fills_contact_field) },
                    onInvoiceRefSelected = { viewModel.onInvoiceRefSelected(it) }
                )
            }

            // Calculated total section
            if (entryDef.table in listOf("sales", "purchases", "transporters")) {
                item {
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Primary.copy(alpha = 0.1f), RoundedCornerShape(10.dp))
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Total", color = AccentCyan, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Due (Total - Advance)", color = TextMuted, fontSize = 11.sp)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("BDT ${"%.2f".format(state.calculatedTotal)}", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = AccentEmerald)
                            Text("BDT ${"%.2f".format(state.calculatedDue)}", fontSize = 13.sp, color = TextMuted)
                        }
                    }
                }
            }

            // Messages
            if (state.error != null) {
                item { Text(state.error!!, color = AccentRose, modifier = Modifier.padding(8.dp)) }
            }
            if (state.successMessage != null) {
                item { Text(state.successMessage!!, color = AccentEmerald, modifier = Modifier.padding(8.dp)) }
            }

            // Buttons
            item {
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = viewModel::submit,
                        modifier = Modifier.weight(1f).height(50.dp),
                        enabled = !state.isSubmitting,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Primary)
                    ) {
                        if (state.isSubmitting) {
                            CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Save Record", fontWeight = FontWeight.SemiBold)
                        }
                    }
                    OutlinedButton(
                        onClick = viewModel::resetForm,
                        modifier = Modifier.height(50.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Reset")
                    }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

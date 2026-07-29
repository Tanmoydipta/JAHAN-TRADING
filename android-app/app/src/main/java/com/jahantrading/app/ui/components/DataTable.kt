package com.jahantrading.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jahantrading.app.ui.theme.*

private val NUMERIC_KEYWORDS = setOf(
    "qty", "quantity", "price", "total", "advance", "due", "rent",
    "cost", "amount", "profit", "revenue", "valuation"
)

private fun isNumericColumn(name: String): Boolean =
    NUMERIC_KEYWORDS.any { name.lowercase().contains(it) }

@Composable
fun DataTable(
    columns: List<String>,
    keys: List<String>,
    rows: List<Map<String, Any?>>,
    modifier: Modifier = Modifier,
    onRowClick: ((Map<String, Any?>) -> Unit)? = null
) {
    val scrollState = rememberScrollState()
    val colWidth = 120.dp

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(BgCard)
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(scrollState)
                .background(BgCardHover)
                .padding(vertical = 10.dp, horizontal = 12.dp)
        ) {
            columns.forEach { col ->
                Text(
                    text = col,
                    modifier = Modifier.width(colWidth),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = if (isNumericColumn(col)) TextAlign.End else TextAlign.Start
                )
            }
        }

        if (rows.isEmpty()) {
            Text(
                "No records found.",
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted,
                textAlign = TextAlign.Center
            )
        } else {
            rows.forEach { row ->
                HorizontalDivider(color = BorderColor)
                Row(
                    modifier = Modifier
                        .horizontalScroll(scrollState)
                        .padding(vertical = 10.dp, horizontal = 12.dp)
                ) {
                    keys.forEachIndexed { i, key ->
                        val value = row[key]
                        val display = when (value) {
                            null -> ""
                            is Number -> String.format("%.2f", value.toDouble())
                            else -> value.toString()
                        }
                        val isNum = value is Number || (i < columns.size && isNumericColumn(columns[i]))
                        Text(
                            text = display,
                            modifier = Modifier.width(colWidth),
                            style = MaterialTheme.typography.bodyMedium,
                            textAlign = if (isNum) TextAlign.End else TextAlign.Start,
                            fontSize = 12.sp
                        )
                    }
                }
            }
        }
    }
}

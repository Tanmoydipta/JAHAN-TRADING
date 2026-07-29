package com.jahantrading.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jahantrading.app.ui.theme.BgCard
import com.jahantrading.app.ui.theme.TextMuted

@Composable
fun KpiCard(
    label: String,
    value: String,
    subtitle: String? = null,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(BgCard)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(accentColor.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center
        ) {
            Text("$", color = accentColor, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Column {
            Text(label, style = MaterialTheme.typography.labelMedium, color = TextMuted)
            Text(value, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color.White)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TextMuted)
            }
        }
    }
}

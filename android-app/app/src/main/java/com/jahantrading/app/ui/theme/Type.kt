package com.jahantrading.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val JahanTypography = Typography(
    headlineLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 0.5.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 18.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 11.sp, color = TextMuted),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextMuted),
    labelSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp, color = TextDim)
)

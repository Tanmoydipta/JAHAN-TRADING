package com.jahantrading.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkScheme = darkColorScheme(
    primary = Primary,
    onPrimary = TextMain,
    secondary = AccentCyan,
    tertiary = AccentEmerald,
    background = BgDark,
    surface = BgCard,
    surfaceVariant = BgCardHover,
    onBackground = TextMain,
    onSurface = TextMain,
    onSurfaceVariant = TextMuted,
    error = AccentRose,
    onError = TextMain,
    outline = BorderColor
)

@Composable
fun JahanTradingTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkScheme,
        typography = JahanTypography,
        content = content
    )
}

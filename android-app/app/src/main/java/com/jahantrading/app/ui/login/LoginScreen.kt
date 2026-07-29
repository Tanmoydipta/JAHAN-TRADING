package com.jahantrading.app.ui.login

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jahantrading.app.ui.theme.*

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(state.isLoggedIn) {
        if (state.isLoggedIn) onLoginSuccess()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Primary.copy(alpha = 0.2f), BgDark),
                    radius = 800f
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 380.dp).padding(24.dp),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = BgCard.copy(alpha = 0.95f))
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Brush.linearGradient(listOf(Primary, AccentCyan))),
                    contentAlignment = Alignment.Center
                ) {
                    Text("J", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                }

                Spacer(Modifier.height(14.dp))
                Text("JAHAN TRADING", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                Text("Business Management Login", style = MaterialTheme.typography.bodySmall, color = TextMuted)

                Spacer(Modifier.height(24.dp))

                OutlinedTextField(
                    value = state.username,
                    onValueChange = viewModel::updateUsername,
                    label = { Text("Username") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
                )

                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = state.password,
                    onValueChange = viewModel::updatePassword,
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { viewModel.login() })
                )

                Spacer(Modifier.height(12.dp))

                // Client ID selector
                OutlinedTextField(
                    value = state.clientId,
                    onValueChange = viewModel::updateClientId,
                    label = { Text("Client Profile") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // API URL config (collapsible)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = viewModel::toggleApiConfig) {
                        Icon(Icons.Default.Settings, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Server", fontSize = 11.sp)
                    }
                }
                AnimatedVisibility(visible = state.showApiConfig) {
                    OutlinedTextField(
                        value = state.apiUrl,
                        onValueChange = viewModel::updateApiUrl,
                        label = { Text("API Server URL") },
                        placeholder = { Text("http://192.168.1.x:5000") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }

                if (state.error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(state.error!!, color = AccentRose, fontSize = 12.sp, textAlign = TextAlign.Center)
                }

                Spacer(Modifier.height(20.dp))

                Button(
                    onClick = viewModel::login,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    enabled = !state.isLoading,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Primary)
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Text("Login", fontWeight = FontWeight.SemiBold)
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text("Default: admin / admin123", style = MaterialTheme.typography.bodySmall, color = TextDim)
            }
        }
    }
}

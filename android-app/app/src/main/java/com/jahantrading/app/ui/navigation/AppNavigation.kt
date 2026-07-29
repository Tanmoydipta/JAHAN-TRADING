package com.jahantrading.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.jahantrading.app.ui.dashboard.DashboardScreen
import com.jahantrading.app.ui.entry.EntryScreen
import com.jahantrading.app.ui.login.LoginScreen
import com.jahantrading.app.ui.report.ReportScreen

object Routes {
    const val LOGIN = "login"
    const val DASHBOARD = "dashboard"
    const val ENTRY = "entry/{entryId}"
    const val REPORT = "report/{reportId}"

    fun entry(entryId: String) = "entry/$entryId"
    fun report(reportId: String) = "report/$reportId"
}

@Composable
fun AppNavHost(navController: NavHostController, startDestination: String = Routes.LOGIN) {
    NavHost(navController = navController, startDestination = startDestination) {

        composable(Routes.LOGIN) {
            LoginScreen(onLoginSuccess = {
                navController.navigate(Routes.DASHBOARD) {
                    popUpTo(Routes.LOGIN) { inclusive = true }
                }
            })
        }

        composable(Routes.DASHBOARD) {
            DashboardScreen(
                onNavigateToEntry = { entryId -> navController.navigate(Routes.entry(entryId)) },
                onNavigateToReport = { reportId -> navController.navigate(Routes.report(reportId)) },
                onLogout = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            Routes.ENTRY,
            arguments = listOf(navArgument("entryId") { type = NavType.StringType })
        ) { backStack ->
            val entryId = backStack.arguments?.getString("entryId") ?: return@composable
            EntryScreen(entryId = entryId, onBack = { navController.popBackStack() })
        }

        composable(
            Routes.REPORT,
            arguments = listOf(navArgument("reportId") { type = NavType.StringType })
        ) { backStack ->
            val reportId = backStack.arguments?.getString("reportId") ?: return@composable
            ReportScreen(reportId = reportId, onBack = { navController.popBackStack() })
        }
    }
}

package com.jahantrading.app.data.remote

import com.jahantrading.app.data.local.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionStore: SessionStore
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()

        val apiBaseUrl = runBlocking { sessionStore.apiBaseUrl.first() }
        val newUrl = if (apiBaseUrl.isNotBlank()) {
            val base = apiBaseUrl.toHttpUrlOrNull() ?: return chain.proceed(original)
            original.url.newBuilder()
                .scheme(base.scheme)
                .host(base.host)
                .port(base.port)
                .build()
        } else {
            original.url
        }

        val token = runBlocking { sessionStore.authToken.first() }
        val builder = original.newBuilder()
            .url(newUrl)
            .header("Content-Type", "application/json")
        if (!token.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $token")
        }

        return chain.proceed(builder.build())
    }
}

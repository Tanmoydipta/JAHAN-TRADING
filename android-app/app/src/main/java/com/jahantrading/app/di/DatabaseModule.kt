package com.jahantrading.app.di

import android.content.Context
import androidx.room.Room
import com.jahantrading.app.data.local.AppDatabase
import com.jahantrading.app.data.local.dao.*
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(context, AppDatabase::class.java, "jahan_cache.db")
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides fun provideProductDao(db: AppDatabase): ProductDao = db.productDao()
    @Provides fun provideCustomerDao(db: AppDatabase): CustomerDao = db.customerDao()
    @Provides fun provideInventoryDao(db: AppDatabase): InventoryDao = db.inventoryDao()
    @Provides fun provideDashboardCacheDao(db: AppDatabase): DashboardCacheDao = db.dashboardCacheDao()
    @Provides fun providePendingEntryDao(db: AppDatabase): PendingEntryDao = db.pendingEntryDao()
}

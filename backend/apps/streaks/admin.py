from django.contrib import admin

from .models import StreakActivity, StreakPolicy, UserStreak

admin.site.register((StreakPolicy, StreakActivity, UserStreak))

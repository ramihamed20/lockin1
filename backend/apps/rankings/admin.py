from django.contrib import admin

from .models import RankingDefinition, RankingEntry, RankingFact, RankingProfile, RankingSnapshot

admin.site.register((RankingDefinition, RankingFact, RankingProfile, RankingSnapshot, RankingEntry))

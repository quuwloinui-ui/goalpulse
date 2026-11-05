import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api_client.dart';
import 'core/config.dart';
import 'core/navigation.dart';
import 'core/push_service.dart';
import 'core/theme.dart';
import 'features/match_details/match_details_screen.dart';
import 'features/shell/main_shell.dart';
import 'providers/app_providers.dart';
import 'providers/favorites_provider.dart';

class GoalPulseApp extends ConsumerStatefulWidget {
  const GoalPulseApp({super.key});

  @override
  ConsumerState<GoalPulseApp> createState() => _GoalPulseAppState();
}

class _GoalPulseAppState extends ConsumerState<GoalPulseApp> {
  @override
  void initState() {
    super.initState();
    final push = ref.read(pushServiceProvider);
    // Tapping a notification opens the match it is about.
    push.onOpenMatch = (id) => navigatorKey.currentState?.push(
          MaterialPageRoute<void>(builder: (_) => MatchDetailsScreen(matchId: id)),
        );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      push.flushPending();
      _bootstrap();
    });
  }

  /// Anonymous device session + restore favourites after a reinstall. Never blocks the UI.
  Future<void> _bootstrap() async {
    try {
      final token = await ref.read(pushServiceProvider).token();
      await ref.read(apiClientProvider).ensureAuth(fcmToken: token);
      await ref.read(favoritesProvider.notifier).restoreFromServer();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      home: const MainShell(),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/match_providers.dart';
import '../favorites/favorites_screen.dart';
import '../home/home_screen.dart';
import '../settings/settings_screen.dart';
import '../standings/standings_screen.dart';

class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final live = ref.watch(liveCountProvider);
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [HomeScreen(), StandingsScreen(), FavoritesScreen(), SettingsScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          NavigationDestination(
            icon: Badge(label: Text('$live'), isLabelVisible: live > 0, child: const Icon(Icons.sports_soccer_outlined)),
            selectedIcon: Badge(label: Text('$live'), isLabelVisible: live > 0, child: const Icon(Icons.sports_soccer)),
            label: 'Matches',
          ),
          const NavigationDestination(icon: Icon(Icons.leaderboard_outlined), selectedIcon: Icon(Icons.leaderboard), label: 'Standings'),
          const NavigationDestination(icon: Icon(Icons.star_outline), selectedIcon: Icon(Icons.star), label: 'Favorites'),
          const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}

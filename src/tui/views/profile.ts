import chalk from 'chalk';
import { Renderer, truncate } from '../renderer.js';
import type { AppState } from '../state.js';

export function renderProfile(renderer: Renderer, state: AppState): void {
  const content: string[] = [];

  content.push('');

  if (!state.profile) {
    content.push(chalk.gray('  No profile set up yet.'));
    content.push('');
    content.push(chalk.gray('  To set up your profile, use:'));
    content.push(chalk.white('    brmonk profile set'));
    content.push(chalk.gray('  Or import a document:'));
    content.push(chalk.white('    brmonk docs import <file>'));
  } else {
    content.push(`  ${chalk.bold('Name')}: ${state.profile.name}`);
    content.push(`  ${chalk.bold('Documents')}: ${state.profile.documentCount}`);
    if (state.profile.documentNames.length > 0) {
      for (const docName of state.profile.documentNames) {
        content.push(`    ${chalk.gray('•')} ${docName}`);
      }
    }
    content.push(`  ${chalk.bold('Items Tracked')}: ${state.profile.itemCount}`);
    if (state.profile.collections.length > 0) {
      content.push(`  ${chalk.bold('Collections')}: ${state.profile.collections.join(', ')}`);
    }
    content.push('');
    content.push(chalk.gray(`  Memory entries: ${state.memoryCount}`));

    // File paths section
    content.push('');
    content.push(`  ${chalk.bold('Data Locations')}`);
    const w = renderer.getWidth() - 6;
    content.push(`  ${chalk.gray('Base dir:')}    ${truncate(state.profile.paths.baseDir, w)}`);
    content.push(`  ${chalk.gray('Profile:')}     ${truncate(state.profile.paths.profileFile, w)}`);
    content.push(`  ${chalk.gray('Documents:')}   ${truncate(state.profile.paths.documentsDir, w)}`);
    content.push(`  ${chalk.gray('Items:')}       ${truncate(state.profile.paths.itemsDir, w)}`);
    content.push(`  ${chalk.gray('Memory:')}      ${truncate(state.profile.paths.memoryDir, w)}`);
    content.push(`  ${chalk.gray('Sessions:')}    ${truncate(state.profile.paths.sessionsDir, w)}`);
    content.push(`  ${chalk.gray('Skills:')}      ${truncate(state.profile.paths.skillsDir, w)}`);
  }

  content.push('');
  content.push(chalk.gray('  [b] Back to dashboard'));

  const lines = renderer.drawBox('Profile', content, { borderColor: 'magenta', titleColor: 'magenta' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}

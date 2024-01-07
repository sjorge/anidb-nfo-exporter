#!/usr/bin/env node
import { program, InvalidArgumentError } from '@commander-js/extra-typings';
import { configureAction } from './configure';
import { createNfoAction } from './create-nfo';

program
    .name("anidb-nfo-exporter")
    .version("1.0.0")
    .description("NFO exporter for anidb");

program
    .command('configure')
    .description('update configuration file')
    .requiredOption('--anidb-client <client>', 'your anidb http client name')
    .requiredOption('--anidb-version <version>', 'your anidb http client version', (value: string) => {
        const id = parseInt(value, 10);
        if (isNaN(id)) throw new InvalidArgumentError('Expecting a number.');
        return id;
    })
    .option('--anidb-poster <yes/no>', 'enable anidb poster fetching')
    .option('--anilist-token <token>', 'your anilist http client token')
    .action(configureAction);

program
    .command('create-nfo')
    .description('write nfo file(s)')
    .argument('<path>', 'path to anime')	
    .option('--aid <id>', 'specify the anidb anime id instead of searching based on directory', (value: string) => {
        const id = parseInt(value, 10);
        if (isNaN(id)) throw new InvalidArgumentError('Expecting a number.');
        return id;
    })
    .action(createNfoAction);

program.parse(process.argv);

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

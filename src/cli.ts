import { program, InvalidArgumentError, OptionValues } from '@commander-js/extra-typings';

program
    .name("anidb-nfo-exporter")
    .version("1.0.0")
    .description("NFO exporter for anidb");

program
    .command('configure')
    .description('create configuration file')
    .requiredOption('-u, --anidb-username <username>', 'your anidb username')
    .requiredOption('-p, --anidb-password <password>', 'your anidb password')
    .action((opts) => {
        console.log('TODO: implement configure command');
        console.log(`username=${opts.anidbUsername}`);
        console.log(`password=${opts.anidbPassword}`);
    });

program
    .command('create-nfo')
    .description('write nfo file(s)')
    .argument('<path>', 'path to anime')	
    .option('--aid <id>', 'specify the anidb anime id instead of searching based on directory', (value: string) => {
        const id = parseInt(value, 10);
        if (isNaN(id)) throw new InvalidArgumentError('Expecting a number.');
        return id;
    })
    .action((path: string, opts: OptionValues) => {
        console.log('TODO: implement create-nfo command');
        console.log(`path=${path}`);
        console.log(`aid=${opts.aid}`);
    });

program.parse(process.argv);

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

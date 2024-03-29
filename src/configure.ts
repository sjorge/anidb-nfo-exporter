import { OptionValues } from '@commander-js/extra-typings';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import toml from '@iarna/toml';
import { deepmerge } from 'deepmerge-ts';

export type Config = {
    anidb: {
        url: string;
        client: {
            name?: string;
            version?: number;
        }
        poster: boolean;
    };
    anilist: {
        token?: string;
    };
    tmdb: {
        api_key?: string;
    };
    cache: {
        path: string;
        anidb_age: number;
        mapping_age: number;
    };
    overwrite_nfo: boolean;
};

const configFile: string = path.join(os.homedir(), '.config', 'anidbne', 'config.toml');

export function readConfig(): Config {
    let config: Config = {
        anidb: {
            url: 'http://api.anidb.net:9001/httpapi',
            client: { },
            poster: false,
        },
        anilist: {},
        tmdb: {},
        cache: {
            path: path.join(os.homedir(), '.cache', 'anidbne'),
            anidb_age: 90,
            mapping_age: 7,
        },
        overwrite_nfo: false,
    };

    if(fs.existsSync(configFile) && fs.statSync(configFile).isFile()) {
        const configToml = toml.parse(fs.readFileSync(configFile, 'utf8')) as Config;
        config = deepmerge(config, configToml);
    }

    return config;
}

function writeConfig(config: Config): boolean {
    try {
        const configFilePath: string = path.dirname(configFile);
        if(!fs.existsSync(configFilePath)) {
            fs.mkdirSync(configFilePath, { recursive: true, mode: 0o750 });
        }
        fs.writeFileSync(configFile, toml.stringify(config), { encoding: 'utf8' });
        fs.chmodSync(configFile, 0o600);
    } catch (error) {
        return false;
    }

    return true;
}

export async function configureAction(opts: OptionValues): Promise<void> {
    const config: Config = readConfig();
    if (opts.anidbClient) config.anidb.client.name = `${opts.anidbClient}`;
    if (opts.anidbVersion) config.anidb.client.version = parseInt(`${opts.anidbVersion}`, 10);
    if (opts.anidbPoster) config.anidb.poster = (`${opts.anidbPoster}` == "yes");
    if (opts.tmdbApiKey) config.tmdb.api_key = `${opts.tmdbApiKey}`;
    if (opts.anilistToken) config.anilist.token = `${opts.anilistToken}`;
    if (opts.overwriteNfo) config.overwrite_nfo = (`${opts.overwriteNfo}` == "yes");
    if(!writeConfig(config)) {
        console.error(`Failed to update ${configFile}!`);
        process.exitCode = 1;
    }
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

import { OptionValues } from '@commander-js/extra-typings';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import toml from '@iarna/toml';
import { deepmerge } from 'deepmerge-ts';

export type AniDBClientConfig = {
    name?: string;
    version?: number;
};

export type AniDBConfig = {
    url: string;
    client: AniDBClientConfig;
};

export type CacheConfig = {
    path: string;
    anidb_age: number;
    mapping_age: number;
};

export type Config = {
    anidb: AniDBConfig;
    cache: CacheConfig;
};

const configFile: string = path.join(os.homedir(), '.config', 'anidbne', 'config.toml');

export function readConfig(): Config {
    let config: Config = {
        anidb: {
            url: 'http://api.anidb.net:9001/httpapi',
            client: { },
        },
        cache: {
            path: path.join(os.homedir(), '.cache', 'anidbne'),
            anidb_age: 90,
            mapping_age: 7,
        },
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
    config.anidb.client.name = `${opts.anidbClient}`;
    config.anidb.client.version = parseInt(`${opts.anidbVersion}`, 10);
    if(!writeConfig(config)) {
        console.error(`Failed to update ${configFile}!`);
        process.exitCode = 1;
    }
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

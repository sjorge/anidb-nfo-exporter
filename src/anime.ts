/*
 * Module with helper classes fro dealing with anime
 *
 * AniDBMetadata
 * - fetch metadata based on anidb id
 * AniDBMapper
 * - fuzzy map titles -> AnimeIDs (type)
 * - map anidb id -> AnimeIDs (type)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import stream from 'node:stream';
import util from 'node:util';
import axios from 'axios';
import xml2js from 'xml2js';
import levenshtein from 'fast-levenshtein';
import anidbjs, { AniDB_Show } from 'anidbjs';
import AniList from "anilist-node";
import { Config } from './configure';

export type AnimeTitleVariant = {
    title: string;
    type?: string;
    language: string;
}

type TitleTable = {
    [anidb: number]: AnimeTitleVariant[];
};

export type AnimeIDs = {
    anidb: number;
    anilist?: number;
    tvdb?: number;
    tvdbSeason?: number;
};

type MappingTable = {
    [anidb: number]: AnimeIDs;
};

type PlexMetaManagerMapping = {
    [anidb: string]: {
        tvdb_id?: number;
        tvdb_season?: number;
        tvdb_epoffset?: number;
        mal_id?: number;
        anilist_id?: number;
        imdb_id?: string;
    };
};

type DataSource = {
    url: string;
    cache: string;
    maxAge: number;
};

export class AniDBMapper {
    private fuzzyMatchThreshhold: number = 5;
    private dataSourceAniDB: DataSource;
    private dataSourcePMM: DataSource;
    private mappingTable: MappingTable = {};
    private titlesTable: TitleTable = {};
    private clientAnilist;

    public constructor(config: Config) {
        if (config.anilist.token) {
            this.clientAnilist = new AniList(
                config.anilist.token,
            );
        }
        this.dataSourceAniDB = {
            url: 'https://anidb.net/api/anime-titles.xml.gz',
            cache: path.join(config.cache.path, 'anime-titles.xml'),
            maxAge: config.cache.mapping_age,
        };
        this.dataSourcePMM = {
            url: 'https://raw.githubusercontent.com/meisnate12/Plex-Meta-Manager-Anime-IDs/master/pmm_anime_ids.json',
            cache: path.join(config.cache.path, 'pmm_anime_ids.json'),
            maxAge: config.cache.mapping_age,
        };
    }

    public toString(): string {
        return 'AniDBMapper';
    }

    public fromTitle(title: string): AnimeIDs | undefined {
        const aidRegEx = new RegExp(/\[anidb-(?<aid>\d+)\]/);

        // match [anidb-<aid>] tag
        const aidMatch: RegExpExecArray | null = aidRegEx.exec(title);
        if (aidMatch !== null) {
            return this.fromId(parseInt(aidMatch[1]));
        }

        // fuzzy search
        const titleNormalized: string = title.replace('⁄', '/');

        let exact_match: number | undefined;
        let best_match: number | undefined;
        let best_match_score: number = 0;

        Object.entries(this.titlesTable).forEach(([key, value]) => {
            const aid: number = parseInt(key);
            const titles: AnimeTitleVariant[] = value;
            titles.forEach((variant: AnimeTitleVariant) => {
                if (variant.title == titleNormalized) {
                    exact_match = aid;
                } else {
                    const distance: number = levenshtein.get(
                        titleNormalized,
                        variant.title,
                        { useCollator: true},
                    );
                    if (distance <= this.fuzzyMatchThreshhold) {
                        if ((best_match == undefined) || (best_match_score > distance)) {
                            best_match = aid;
                            best_match_score = distance;
                        }
                    }
                }
            });

        });

        if (exact_match !== undefined) {
            return this.fromId(exact_match);
        } else if (best_match !== undefined) {
            return this.fromId(best_match);
        }

        return undefined;
    }

    public fromId(aid: number): AnimeIDs | undefined {
        return this.mappingTable[aid];
    }

    public titleFromId(aid: number): AnimeTitleVariant[] {
        return this.titlesTable[aid];
    }

    public async queryAnilistId(aid: number): Promise<AnimeIDs | undefined> {
        const ids = this.fromId(aid);
        if (ids == undefined) return ids;
        if (ids?.anilist) return ids;

        // select official japanese title
        const mainTitle: AnimeTitleVariant[] = this.titleFromId(aid).filter((t: AnimeTitleVariant) => {
            if ((t.type == "official") && (t.language == 'ja')) {
                return t;
            }
        });

        let exactMatch = false;
        const result = await this.clientAnilist?.searchEntry.anime(mainTitle[0].title);
        result?.media.forEach((media) => {
            if (media.title.native == mainTitle[0].title) {
                ids.anilist = media.id;
                exactMatch = true;
                this.updateMapping(aid, media.id);
            }
        });
        if (!exactMatch && (result?.media.length == 1)) {
            ids.anilist = result?.media[0].id;
            exactMatch = true;
            this.updateMapping(aid, result?.media[0].id);
        }

        return ids;
    }

    private updateMapping(aid: number, anilist?: number, tvdb?: number, tvdbSeason?: number): void {
        let ids = this.fromId(aid);
        if (ids == undefined) {
            // initialise new map
            ids = {
                anidb: aid,
                anilist: anilist,
                tvdb: tvdb,
                tvdbSeason: tvdbSeason,
            } as AnimeIDs;
        } else {
            // update existing map
            if (anilist !== undefined) ids.anilist = anilist;
            if (tvdb !== undefined) ids.tvdb = tvdb;
            if ((tvdb !== undefined) && (tvdbSeason !== undefined)) {
                ids.tvdbSeason = tvdbSeason;
            }
        }
        this.mappingTable[aid] = ids;
    }

    private updateTitles(aid: number, titles: AnimeTitleVariant[]): void {
        this.titlesTable[aid] = titles;
    }

    private async updateDataSource(ds: DataSource): Promise<boolean> {
        // skip if cache is fresh
        if (fs.existsSync(ds.cache)) {
            const cacheStats = fs.statSync(ds.cache);
            if (((new Date().getTime() - cacheStats.mtimeMs) / 1000 / 3600 / 24) < ds.maxAge) {
                 return true;
            }
        }

        // update cache
        try {
            // ensure cache dir exists
            fs.mkdirSync(path.dirname(ds.cache), { recursive: true, mode: 0o750 });

            // updateDataSource and save cache file
            await axios.get(ds.url, { responseType: 'stream' }).then(async (response) => {
                const writer = fs.createWriteStream(ds.cache, { encoding: 'utf8', mode: 0o660 });
                if (path.extname(ds.url) == '.gz') {
                    response.data.pipe(zlib.createGunzip()).pipe(writer);
                } else {
                    response.data.pipe(writer);
                }
                await util.promisify(stream.finished)(writer);
            });
        } catch (err) {
            return false;
        }

        return true;
    }

    private parseDataSourceAniDB(): boolean {
        let parserStatus = true;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        xml2js.parseString(fs.readFileSync(this.dataSourceAniDB.cache, 'utf8'), (err: Error | null, result: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (err !== null) parserStatus = false;
            result.animetitles?.anime?.forEach((anime: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const aid: number = parseInt(anime.$?.aid);
                const titles: AnimeTitleVariant[] = [];
                anime.title?.forEach((titleData: any) => {
                    const titleVariant: AnimeTitleVariant = {
                        title: titleData._,
                        type: titleData.$?.type,
                        language: titleData.$['xml:lang'],
                    };
                    if ((titleVariant.type !== undefined) && (['official', 'main'].includes(titleVariant.type))) {
                        titles.push(titleVariant);
                    }
                });
                this.updateTitles(aid, titles);
            });
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        return parserStatus;
    }

    private parseDataSourcePMM(): boolean {
        const data: PlexMetaManagerMapping = JSON.parse(fs.readFileSync(this.dataSourcePMM.cache, 'utf8'));

        for (const key in data) {
            const ids = data[key];
            this.updateMapping(parseInt(key), ids.anilist_id, ids.tvdb_id, ids.tvdb_season);
        }

        return true;
    }

    public async refresh(): Promise<boolean> {
        // update datasource cache
        if (!await this.updateDataSource(this.dataSourceAniDB)) return false;
        if (!await this.updateDataSource(this.dataSourcePMM)) return false;

        // parse data
        if (!this.parseDataSourceAniDB()) return false;
        if (!this.parseDataSourcePMM()) return false;

        return true;
    }
}


export class AniDBMetadata {
    private clientAniDB;
    private cachePath: string;
    private cacheAge: number;

    public constructor(config: Config) {
        this.clientAniDB = new anidbjs({
            client: config.anidb.client.name,
            version: config.anidb.client.version,
        });
        this.cachePath = config.cache.path;
        this.cacheAge = config.cache.anidb_age;
    }

    public toString(): string {
        return 'AniDBMetadata';
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    public async get(id: AnimeIDs): Promise<AniDB_Show | undefined> {
        let metadata: undefined;

        // skip if cache is fresh
        const dbCacheFile: string = path.join(this.cachePath, 'anidb', `${id.anidb}.json`);
        if (fs.existsSync(dbCacheFile)) {
            const cacheStats = fs.statSync(dbCacheFile);
            if (((new Date().getTime() - cacheStats.mtimeMs) / 1000 / 3600 / 24) < this.cacheAge) {
                return JSON.parse(fs.readFileSync(dbCacheFile, 'utf8')) as AniDB_Show;
            }
        }

        // update cache
        try {
            // ensure cache dir exists
            fs.mkdirSync(path.dirname(dbCacheFile), { recursive: true, mode: 0o750 });

            // query anidb and store
            await this.clientAniDB.anime(id.anidb).then((res: any) => {
                fs.writeFileSync(dbCacheFile, JSON.stringify(res), {encoding: 'utf8', mode: 0o660});
                metadata = res;
            }).catch((err: any) => {
                if (err.status == 'Client version missing or invalid') {
                    throw new Error("Please register a HTTP client on anidb and run 'configure' command again!");
                } else {
                    throw new Error(err.status);
                }
            });
        } catch(err) {
            throw new Error(err.status);
        }

        return metadata;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

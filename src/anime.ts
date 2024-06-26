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
import { MovieDb } from "moviedb-promise";
import { Config } from './configure';

export type AnimeTitleVariant = {
    title: string;
    type?: string;
    year?: number;
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
    tmdb?: number;
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

type LocalMapping = {
    [anidb: string]: {
        anilist_id?: number;
        tmdb_id?: number;
    };
};

type DataSource = {
    url: string;
    cache: string;
    maxAge: number;
};

export class AniDBMapper {
    private fuzzyMatchThreshhold: number = 3;
    private dataSourceAniDB: DataSource;
    private dataSourcePMM: DataSource;
    private dataSourceLocal: string;
    private mappingTable: MappingTable = {};
    private titlesTable: TitleTable = {};
    private clientAnilist;
    private clientTMDB;

    public constructor(config: Config) {
        if (config.anilist.token) {
            this.clientAnilist = new AniList(config.anilist.token);
        }
        if (config.tmdb.api_key) {
            this.clientTMDB = new MovieDb(config.tmdb.api_key);
        }
        this.dataSourceAniDB = {
            url: 'https://anidb.net/api/anime-titles.xml.gz',
            cache: path.join(config.cache.path, 'anime-titles.xml'),
            maxAge: config.cache.mapping_age,
        };
        this.dataSourcePMM = {
            url: 'https://raw.githubusercontent.com/Kometa-Team/Anime-IDs/master/anime_ids.json',
            cache: path.join(config.cache.path, 'pmm_anime_ids.json'),
            maxAge: config.cache.mapping_age,
        };
        this.dataSourceLocal = path.join(config.cache.path, 'local_ids.json');
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

    public async queryAnilistId(aid: number): Promise<AnimeIDs> {
        let ids = this.fromId(aid);
        if (ids == undefined) {
            ids = {
                anidb: aid,
            } as AnimeIDs;
        }

        // quick return if we already have an anilist id
        if (ids.anilist) return ids;

        // search for anilist id by search + comparing main or official japanese title
        if (this.clientAnilist) {
            // select official japanese title if available
            const mainTitle: AnimeTitleVariant[] = this.titleFromId(aid).filter((t: AnimeTitleVariant) => {
                if ((t.type == "official") && (t.language == 'ja')) {
                    return t;
                } else if ((t.type == "main") && (t.language == 'x-jat')) {
                    return t;
                }
            });

            // extract year variants
            for (const tv of mainTitle) {
                const titleYearRegEx = new RegExp(/^(.+)\s\((\d{4})\)$/);
                const t = tv as AnimeTitleVariant;

                if(t.year !== undefined) continue;

                const tilteYearMatch: RegExpExecArray | null = titleYearRegEx.exec(t.title);
                if (tilteYearMatch !== null) {
                    const nt: AnimeTitleVariant = {
                        title: tilteYearMatch[1],
                        year: parseInt(tilteYearMatch[2]),
                        type: t.type,
                        language: t.language,
                    };
                    mainTitle.push(nt);
                }
            }

            let exact_match: number | undefined;
            let best_match: number | undefined;
            let best_match_score: number = 0;
            for (const tv of mainTitle) {
                const t = tv as AnimeTitleVariant;

                if (exact_match == undefined) {
                    const result = await this.clientAnilist.searchEntry.anime(t.title);
                    if (result?.media) {
                        for (const media of result.media) {
                            const mt = (t.language == 'ja') ? media.title.native : media.title.romaji;
                            if ((mt !== undefined) && (mt !== null)) {
                                if (t.year !== undefined) {
                                    // WARN: titles with an extract year should come first so we don't match
                                    //       the first season with the exact_match filter!
                                    //
                                    //       we multiple fuzzyMatchThreshhold by 4 for English
                                    //       and by 1.5 for Japanese to cover things like 'Xth season'
                                    if (this.clientAnilist) {
                                        const mediaData = await this.clientAnilist.media.anime(media.id);
                                        if (mediaData?.seasonYear == t.year) {
                                            const distance: number = levenshtein.get(
                                                t.title.toLowerCase(),
                                                mt.toLowerCase(),
                                                { useCollator: true},
                                            );

                                            if (distance <= (this.fuzzyMatchThreshhold * ((t.language == 'ja') ? 1.5 : 4))) {
                                                if ((best_match == undefined) || (best_match_score > distance)) {
                                                    best_match = media.id;
                                                    best_match_score = distance;
                                                }
                                            }
                                        }
                                    }
                                } else if (mt.toLowerCase() == t.title.toLowerCase()) {
                                    exact_match  = media.id;
                                } else {
                                    const distance: number = levenshtein.get(
                                        t.title.toLowerCase(),
                                        mt.toLowerCase(),
                                        { useCollator: true},
                                    );
                                    if (distance == 0) {
                                        exact_match  = media.id;
                                    } else if (distance <= this.fuzzyMatchThreshhold) {
                                        if ((best_match == undefined) || (best_match_score > distance)) {
                                            best_match = media.id;
                                            best_match_score = distance;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (exact_match !== undefined) {
                return this.linkAnilist(aid, exact_match);
            } else if (best_match !== undefined) {
                return this.linkAnilist(aid, best_match);
            }
        }

        return ids;
    }

    public async queryTMDBId(aid: number): Promise<AnimeIDs> {
        let ids = this.fromId(aid);
        if (ids == undefined) {
            ids = {
                anidb: aid,
            } as AnimeIDs;
        }

        // quick return if we already have an tmdb id
        if (ids.tmdb) return ids;

        // search for tmdb id by search + comparing main or official japanese title
        if (this.clientTMDB) {
            // select official japanese title if available
            const mainTitle: AnimeTitleVariant[] = this.titleFromId(aid).filter((t: AnimeTitleVariant) => {
                if ((t.type == "official") && (t.language == 'ja')) {
                    return t;
                } else if ((t.type == "main") && (t.language == 'x-jat')) {
                    return t;
                }
            });

            let exact_match: number | undefined;
            let best_match: number | undefined;
            //const best_match_score: number = 0;

            for (const tv of mainTitle) {
                const t = tv as AnimeTitleVariant;

                if (exact_match == undefined) {
                    const tmdbData = await this.clientTMDB.searchTv({query: t.title, include_adult: true});

                    tmdbData?.results?.forEach((media) => {
                        // ignore tv shows without genre_id 16 (Animation)
                        if ((media.genre_ids?.includes(16)) && (exact_match == undefined)) {
                            const mt = (t.language == 'ja') && (media.original_language == 'ja') ? media.original_name : media.name;
                            if ((mt !== undefined) && (mt !== null)) {
                                if (mt.toLowerCase() == t.title.toLowerCase()) {
                                    exact_match  = media.id;
                                } else {
                                    const distance: number = levenshtein.get(
                                        t.title.toLowerCase(),
                                        mt.toLowerCase(),
                                        { useCollator: true},
                                    );

                                    if (distance == 0) {
                                        exact_match  = media.id;
                                    /* distance greater than 0 causes to many incorrect matches
                                    } else if (distance <= this.fuzzyMatchThreshhold) {
                                        if ((best_match == undefined) || (best_match_score > distance)) {
                                            best_match = media.id;
                                            best_match_score = distance;
                                        }
                                    */
                                    }
                                }
                            }
                        }
                    });
                }
            }

            if (exact_match !== undefined) {
                return this.linkTMDB(aid, exact_match);
            } else if (best_match !== undefined) {
                return this.linkTMDB(aid, best_match);
            }
        }

        return ids;
    }

    public linkAnilist(aid: number, anilist: number, store: boolean = true): AnimeIDs {
        let ids = this.fromId(aid);

        if (ids == undefined) {
            // initialise new map
            ids = {
                anidb: aid,
                anilist: anilist,
            } as AnimeIDs;
        }

        ids.anilist = anilist;
        this.mappingTable[aid] = ids;
        if (store) this.storeLocal(aid, anilist);
        return ids;
    }

    public linkTMDB(aid: number, tmdb: number, store: boolean = true): AnimeIDs {
        let ids = this.fromId(aid);

        if (ids == undefined) {
            // initialise new map
            ids = {
                anidb: aid,
                tmdb: tmdb,
            } as AnimeIDs;
        }

        ids.tmdb = tmdb;
        this.mappingTable[aid] = ids;
        if (store) this.storeLocal(aid, undefined, tmdb);
        return ids;
    }

    private updateMapping(aid: number, anilist?: number, tvdb?: number, tvdbSeason?: number, tmdb?: number): void {
        let ids = this.fromId(aid);

        if (ids == undefined) {
            // initialise new map
            ids = {
                anidb: aid,
                anilist: anilist,
                tvdb: tvdb,
                tvdbSeason: tvdbSeason,
                tmdb: tmdb,
            } as AnimeIDs;
        } else {
            // update existing map
            if (anilist !== undefined) ids.anilist = anilist;
            if (tvdb !== undefined) ids.tvdb = tvdb;
            if ((tvdb !== undefined) && (tvdbSeason !== undefined)) {
                ids.tvdbSeason = tvdbSeason;
            }
            if (tmdb !== undefined) ids.tmdb = tmdb;
        }

        this.mappingTable[aid] = ids;
    }

    private updateTitles(aid: number, titles: AnimeTitleVariant[]): void {
        this.titlesTable[aid] = titles;
        this.updateMapping(aid); // create a empty ID mapping for every known aid
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

    private storeLocal(aid: number, anilist?: number, tmdb?: number): boolean {
        // update cache
        try {
            // ensure cache dir exists
            fs.mkdirSync(path.dirname(this.dataSourceLocal), { recursive: true, mode: 0o750 });

            let data: LocalMapping = {};
            if (fs.existsSync(this.dataSourceLocal)) {
                data = JSON.parse(fs.readFileSync(this.dataSourceLocal, 'utf8')) as LocalMapping;
            }

            if (data[aid] == undefined) data[aid] = {};
            if (anilist) data[aid].anilist_id = anilist;
            if (tmdb) data[aid].tmdb_id = tmdb;

            fs.writeFileSync(this.dataSourceLocal, JSON.stringify(data), { encoding: 'utf8' });
            fs.chmodSync(this.dataSourceLocal, 0o660);
        } catch(err) {
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

    private parseDataSourceLocal(): boolean {
        if (fs.existsSync(this.dataSourceLocal)) {
            const data: LocalMapping = JSON.parse(fs.readFileSync(this.dataSourceLocal, 'utf8'));

            for (const key in data) {
                const localIds = data[key];
                const ids = this.fromId(parseInt(key));

                // local IDs have lower priority than other sources, only update when unset
                this.updateMapping(
                    parseInt(key),
                    (ids?.anilist) ? ids.anilist : localIds.anilist_id,
                    undefined,
                    undefined,
                    (ids?.tmdb) ? ids.tmdb : localIds.tmdb_id,
                );
            }
        }

        return true;
    }

    public async refresh(): Promise<boolean> {
        let result = true;

        // update datasource cache and parse data
        if (await this.updateDataSource(this.dataSourceAniDB)) {
            // WARN: AniDB is required for PMM and Local
            //       return imediatly on failure
            if (!this.parseDataSourceAniDB()) return false;

            if (await this.updateDataSource(this.dataSourcePMM)) {
                if (!this.parseDataSourcePMM()) result = false;
            }

            if (!this.parseDataSourceLocal()) result = false;

            return result;
        }

        return false;
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
    public async get(id: AnimeIDs, force: boolean = false): Promise<AniDB_Show | undefined> {
        let metadata: undefined;

        // skip if cache is fresh
        const dbCacheFile: string = path.join(this.cachePath, 'anidb', `${id.anidb}.json`);
        if (fs.existsSync(dbCacheFile) && !force) {
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
                } else if (err.status == 'Banned') {
                    throw new Error("Please try again in 24h, we are currently banned!");
                } else {
                    throw new Error(err.status);
                }
            });
        } catch(err) {
            return undefined;
        }

        return metadata;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

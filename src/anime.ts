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
import { Config } from './configure';

export type AnimeTitleVariant = {
    title: string;
    type: string;
    lang: string;
}

export type AnimeTitles = {
    anidb: number;
    title: AnimeTitleVariant[];
};

type AniDBTitlesTable = {
    [anidb: number]: AnimeTitles;
};

export type AnimeIDs = {
    anidb: number;
    anilist?: number;
    tvdb?: number;
    tvdbSeason?: number;
};

type AniDBMappingTable = {
    [anidb: number]: AnimeIDs;
};

type PlexMetaManagerIDs = {
    tvdb_id?: number;
    tvdb_season?: number;
    tvdb_epoffset?: number;
    mal_id?: number;
    anilist_id?: number;
    imdb_id?: string;
};

type PlexMetaManagerMappingTable = {
    [anidb: string]: PlexMetaManagerIDs;
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
    private mappingTable: AniDBMappingTable = {};
    private titlesTable: AniDBTitlesTable = {};

    public constructor(config: Config) {
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

        let exact_match: AnimeTitles | undefined;
        let best_match: AnimeTitles | undefined;
        let best_match_score: number = 0;

        Object.values(this.titlesTable).forEach((title: AnimeTitles) => {
            title.title?.forEach((variant: AnimeTitleVariant) => {
                if (variant.title == titleNormalized) {
                    exact_match = title;
                } else {
                    const distance: number = levenshtein.get(
                        titleNormalized,
                        variant.title,
                        { useCollator: true},
                    );
                    if (distance <= this.fuzzyMatchThreshhold) {
                        if ((best_match == undefined) || (best_match_score > distance)) {
                            best_match = title;
                            best_match_score = distance;
                        }
                    }
                }
            });

        });

        if (exact_match !== undefined) {
            return this.fromId(exact_match.anidb);
        } else if (best_match !== undefined) {
            return this.fromId(best_match.anidb);
        }

        return undefined;
    }

    public fromId(aid: number): AnimeIDs | undefined {
        return this.mappingTable[aid];
    }

    public titleFromId(aid: number): AnimeTitles | undefined {
        return this.titlesTable[aid];
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

    private updateTitles(aid: number, title: AnimeTitleVariant[]): void {
        this.titlesTable[aid] = {
            anidb: aid,
            title: title,
        } as AnimeTitles;
    }

    private async updateDataSource(ds: DataSource): Promise<boolean> {
        // skip if cache is fresh
        if (fs.existsSync(ds.cache)) {
            const cacheStats = fs.statSync(ds.cache);
            if (((new Date().getTime() - cacheStats.mtimeMs) / 1000 / 3600 / 24) > ds.maxAge) {
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
                const title: AnimeTitleVariant[] = [];
                anime.title?.forEach((titleData: any) => {
                    const titleVariant: AnimeTitleVariant = {
                        title: titleData._,
                        type: titleData.$?.type,
                        lang: titleData.$['xml:lang'],
                    };
                    if (['official', 'main'].includes(titleVariant.type)) {
                        title.push(titleVariant);
                    }
                });
                this.updateTitles(aid, title);
            });
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        return parserStatus;
    }

    private parseDataSourcePMM(): boolean {
        const data: PlexMetaManagerMappingTable = JSON.parse(fs.readFileSync(this.dataSourcePMM.cache, 'utf8'));

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

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

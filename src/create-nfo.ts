import { OptionValues } from '@commander-js/extra-typings';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import braces from 'braces';
import { Config, readConfig } from './configure';
import {
    Anime, AnimeNfo,
    Episode, EpisodeNfo,
    UniqueId
} from './nfo';
import {
    AniDBMetadata,
    AniDBMapper,
    AnimeIDs,
    AnimeTitleVariant,
} from './anime';
import { EpisodeMapper, EpisodeFile } from './episode';


function log(msg: string, type: "error" | "step" | "done" | "info" = "info"): void {
    const blank: number = process.stdout.columns ? (process.stdout.columns) : 0;
    switch(type) {
        case "error":
            process.stderr.write(`\r${" ".repeat(blank)}\r[\x1b[31m!!\x1b[0m] ${msg}\n`);
            break;
        case "info":
            process.stdout.write(`\r${" ".repeat(blank)}\r[\x1b[34mII\x1b[0m] ${msg}\n`);
            break;
        case "done":
            process.stdout.write(`\r${" ".repeat(blank)}\r[\x1b[32mOK\x1b[0m] ${msg}\n`);
            break;
        case "step":
            process.stdout.write(`\r${" ".repeat(blank)}\r[\x1b[33m>>\x1b[0m] ${msg}`);
            break;
    }
}

export async function createNfoAction(animeDir: string, opts: OptionValues): Promise<void> {
    // sanity check config (only for udp client)
    const config: Config = readConfig();
    if ((config.anidb.client.name == undefined) || (config.anidb.client.version == undefined)) {
        log("Please run 'configure' and configure at least --anidb-client and --anidb-version!", "error");
        process.exitCode = 1;
        return;
    }

    // overwrite NFO
    let overwrite = config.overwrite_nfo;
    if (opts.overwriteNfo) overwrite = (`${opts.overwriteNfo}` == "yes");

    // identify anime
    let id: AnimeIDs | undefined;
    const metadata = new AniDBMetadata(config);
    const mapper = new AniDBMapper(config);
    await mapper.refresh();

    if(!fs.existsSync(animeDir) || !fs.statSync(animeDir).isDirectory()) {
        log(`Anime directory "${animeDir}" does not exist!`, "error");
        process.exitCode = 1;
        return;
    }

    let title: string = path.basename(animeDir);
    log(`{      } ${title}: Identifying ...`, "step");
    if (opts.aid) {
        id = mapper.fromId(parseInt(`${opts.aid}`));
        if (id != null) {
            log(`{${id.anidb.toString().padStart(6)}} ${title}: Matched via --aid parameter ...`, "step");
        }
    } else {
        id = mapper.fromTitle(title);
        if (id != null) {
            log(`{${id.anidb.toString().padStart(6)}} ${title}: Matched via title search...`, "step");
        }
    }

    // fuzzy search for anilist ID and TMDB ID
    if (id?.anidb) {
        id = await mapper.queryAnilistId(id.anidb);
    }

    if (id == undefined) {
        log(`{      } ${title}: Failed to match AniDB Id via title search!`, "error");
        process.exitCode = 1;
        return;
    } else {
        mapper.titleFromId(id.anidb)?.forEach((t: AnimeTitleVariant) => {
            if ((t.type == 'main') && (t.language == 'x-jat')) {
                title = t.title;
            }
        });

        log(`{${id.anidb.toString().padStart(6)}} ${title}: Retrieving metadata ...`, "step");
        try {
            // retrieve anidb metadata
            const data = await metadata.get(id);
            if (data == undefined) {
                log(`{${id.anidb.toString().padStart(6)}} ${title}: Failed to retreive metadata!`, "error");
                process.exitCode = 1;
                return;
            }

            // create anime object
            const anime: Anime = {
                uniqueId: [ {type: "anidb", id: id.anidb, default: true} as UniqueId ],
                title: title.replace("`", "'"),
            };

            // WARN: tvdb mapping cause weird issues
            //if (id.tvdb) anime.uniqueId.push({type: "tvdb", id: id.tvdb} as UniqueId);
            if (id.anilist) anime.uniqueId.push({type: "anilist", id: id.anilist} as UniqueId)

            data.titles.forEach((t: AnimeTitleVariant) => {
                if ((t.type == 'main') && (t.language == 'x-jat')) {
                    anime.title = t.title.replace("`", "'");
                } else if ((t.type == 'official') && (t.language == 'ja')) {
                    anime.originaltitle = t.title.replace("`", "'");
                }
            });

            if (data.startDate && (data.startDate.length == 10)) {
                anime.premiered = data.startDate;
            } else if (data.startDate && (data.startDate.length == 7)) {
                anime.premiered = `${data.startDate}-01`;
            }

            // WARN: jellyfin seems to do better without season/plot hints
            /*
            anime.season = 1;
            anime.episode = data.episodeCount;
            anime.plot = data.description;
            */

            anime.poster = data.picture;

            if (data.ageRestricted) anime.mpaa = 'NC-17';

            // write NFO
            const nfo = new AnimeNfo(anime, animeDir);
            if (await nfo.write(overwrite, config.anidb.poster)) {
                const episodeMapper = new EpisodeMapper(animeDir);
                let episodeNfoWriten = true;

                for (let file of episodeMapper.episodes()) {
                    file = file as EpisodeFile;
                    const multiEpisode: Episode[] = [];
                    const episodeStart: number = parseInt(file.episodeStart);
                    const episodeEnd: number = parseInt(file.episodeEnd);

                    let episodes: string[] = [];
                    if (isNaN(episodeStart) || isNaN(episodeEnd)) {
                        episodes = [ file.episodeStart ];
                    } else {
                        episodes = braces.expand(`{${episodeStart}..${episodeEnd}}`);
                    }

                    for (const ep of episodes) {
                        for (const episodeMetadata of data.episodes) {
                            if (episodeMetadata.episodeNumber == `${ep}`) {
                                const episode: Episode = {
                                    uniqueId: [ {type: "anidb", id: episodeMetadata.id, default: true} as UniqueId ],
                                    title: file.title.replace("`", "'"),
                                };
                                switch (episodeMetadata.type) {
                                    case 1:
                                        episode.season = 1;
                                        episode.episode = parseInt(episodeMetadata.episodeNumber);
                                        break;
                                    default:
                                        episode.season = 0;
                                        episode.episode = (parseInt(episodeMetadata.episodeNumber.substring(1)) + (episodeMetadata.type * 100));
                                        break;
                                }
                                if (episodeMetadata.airDate && (episodeMetadata.airDate.length == 10)) {
                                    episode.premiered = episodeMetadata.airDate;
                                } else if (episodeMetadata.airDate && (episodeMetadata.airDate.length == 7)) {
                                    episode.premiered = `${episodeMetadata.airDate}-01`;
                                }

                                // WARN: jellyfin seems to do better without season/plot hints
                                //if (episodeMetadata.summary) episode.plot = episodeMetadata.summary;

                                episodeMetadata.titles.forEach((t: AnimeTitleVariant) => {
                                    if (t.language == 'en') {
                                        episode.title = t.title.replace("`", "'");
                                    } else if (t.language == 'ja') {
                                        episode.originaltitle = t.title.replace("`", "'");
                                    }
                                });

                                multiEpisode.push(episode);
                            }
                        }
                    }

                    const episodeNfo = new EpisodeNfo(multiEpisode, file.path);
                    if(!await episodeNfo.write(overwrite)) episodeNfoWriten = false;
                }

                if (episodeNfoWriten) {
                    log(`{${id.anidb.toString().padStart(6)}} ${title}: Succesfully written all NFO files.`, "done");
                } else {
                    log(`{${id.anidb.toString().padStart(6)}} ${title}: Failed to write all NFO files!`, "error");
                }
            }
        } catch(err) {
            log(`{      } ${title}: ${(err as Error).message}`, "error");
            process.exitCode = 1;
            return;
        }
    }
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

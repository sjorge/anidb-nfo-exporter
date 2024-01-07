import { OptionValues } from '@commander-js/extra-typings';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
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

export async function createNfoAction(animeDir: string, opts: OptionValues): Promise<void> {
    // sanity check config (only for udp client)
    const config: Config = readConfig();
    if ((config.anidb.client.name == undefined) || (config.anidb.client.version == undefined)) {
        console.error("Please run 'configure' command at least once!");
        process.exitCode = 1;
        return;
    }

    // identify anime
    let id: AnimeIDs | undefined;
    const metadata = new AniDBMetadata(config);
    const mapper = new AniDBMapper(config);
    await mapper.refresh();

    if(!fs.existsSync(animeDir) || !fs.statSync(animeDir).isDirectory()) {
        console.error(`Anime directory "${animeDir}" does not exist!`);
        process.exitCode = 1;
        return;
    }

    let title: string = path.basename(animeDir);
    if (opts.aid) {
        id = mapper.fromId(parseInt(`${opts.aid}`));
        if (id != null) {
            console.log(`Matched anidb id (${id.anidb}) from --aid parameter.`);
        }
    } else {
        console.log(`Identifying "${title}" ...`);
        id = mapper.fromTitle(title);
        if (id != null) {
            console.log(`Matched as anidb id (${id.anidb}) from title ...`);
        }
    }

    // try to complete anilist ID if missing by searching
    if (id?.anidb) id = await mapper.queryAnilistId(id.anidb);

    if (id == undefined) {
        console.error('Failed to map anidb id from title.');
        process.exitCode = 1;
        return;
    } else {
        mapper.titleFromId(id.anidb)?.forEach((t: AnimeTitleVariant) => {
            if ((t.type == 'main') && (t.language == 'x-jat')) {
                title = t.title;
            }
        });

        console.log(`Retreiving metadata for "${title}" [${id.anidb}]`);
        try {
            // retrieve anidb metadata
            const data = await metadata.get(id);
            if (data == undefined) {
                console.error('Failed to retreive metadata!');
                process.exitCode = 1;
                return;
            }

            // create anime object
            const anime: Anime = {
                uniqueId: [ {type: "anidb", id: id.anidb, default: true} as UniqueId ],
                title: title,
            };

            if (id.tvdb) anime.uniqueId.push({type: "tvdb", id: id.tvdb} as UniqueId);
            if (id.anilist) anime.uniqueId.push({type: "anilist", id: id.anilist} as UniqueId)

            data.titles.forEach((t: AnimeTitleVariant) => {
                if ((t.type == 'main') && (t.language == 'x-jat')) {
                    anime.title = t.title;
                } else if ((t.type == 'official') && (t.language == 'ja')) {
                    anime.originaltitle = t.title;
                }
            });

            anime.premiered = data.startDate;

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
            if (await nfo.write(config.anidb.poster)) {
                const episodeMapper = new EpisodeMapper(animeDir);

                episodeMapper.episodes().forEach((file: EpisodeFile) => {
                    const multiEpisode: Episode[] = [];
                    for (let ep = parseInt(file.episodeStart); ep <= parseInt(file.episodeEnd); ep++) {
                        data?.episodes?.forEach((episodeMetadata) => {
                            if (episodeMetadata.episodeNumber == `${ep}`) {
                                const episode: Episode = {
                                    uniqueId: [ {type: "anidb", id: episodeMetadata.id, default: true} as UniqueId ],
                                    title: file.title,
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
                                if (episodeMetadata.airDate) episode.premiered = episodeMetadata.airDate;

                                // WARN: jellyfin seems to do better without season/plot hints
                                //if (episodeMetadata.summary) episode.plot = episodeMetadata.summary;

                                episodeMetadata.titles.forEach((t: AnimeTitleVariant) => {
                                    if (t.language == 'en') {
                                        episode.title = t.title;
                                    } else if (t.language == 'ja') {
                                        episode.originaltitle = t.title;
                                    }
                                });

                                multiEpisode.push(episode);
                            }
                        });
                    }

                    const episodeNfo = new EpisodeNfo(multiEpisode, file.path);
                    episodeNfo.write();
                });
            }
        } catch(err) {
            console.error((err as Error).message);
            process.exitCode = 1;
            return;
        }
    }
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

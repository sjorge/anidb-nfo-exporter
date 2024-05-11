/*
 * Helper types and functions for writing tvshow.nfo files for Anime.
 * 
 * This is not a full tvshow.nfo implementation and we omit a lot of
 *   optional fields.
 */
import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import util from 'node:util';
import axios from 'axios';
import { create, fragment } from 'xmlbuilder2';

export type UniqueId = {
    id: string|number;
    type: string;
    default?: boolean;
};

export type Actor = {
    name: string;
    role: string;
    order?: number;
};

export type Anime = {
    uniqueId: UniqueId[];
    title: string;
    originaltitle?: string;
    sorttitle?: string;
    premiered?: string;
    season?: number;
    episode?: number;
    tagline?: string;
    plot?: string;
    mpaa?: string;
    tag?: string[]; 
    studio?: string[];
    actor?: Actor[];
    poster?: string;
};

export type Episode = {
    uniqueId: UniqueId[];
    title: string;
    originaltitle?: string;
    premiered?: string;
    season?: number;
    episode?: number;
    plot?: string;
};

export class AnimeNfo {
    private anime: Anime;
    private path: string;
 
    public constructor(anime: Anime, animePath: string) {
        this.anime = anime;
        this.path = animePath;

        // check path exists
        if(!fs.existsSync(this.path) || !fs.statSync(this.path).isDirectory()) {
            throw new Error(`The path '${this.path}' does not exist or is not a directory!`);
        }
    }

    public toString(): string {
        return `AnimeNfo(title=${this.anime.title})`;
    }

    public isValid(): boolean {
        // NOTE: uniqueId must minimally have one entry
        if (Object.values(this.anime.uniqueId).length < 1) return false;

        // NOTE: if we only have one uniqueId, it must be the default
        if (Object.values(this.anime.uniqueId).length == 1) {
            this.anime.uniqueId[0].default = true;
        }

        // NOTE: we need to have exactly one default uniqueId
        if (this.anime.uniqueId.filter((id: UniqueId) => id.default === true).length !== 1) return false;

        // NOTE: premiered must be YYYY-MM-DD format if specified
        if (this.anime.premiered) {
            const premieredRegEx = new RegExp(/(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/);
            if (!premieredRegEx.test(this.anime.premiered)) return false;
            if (isNaN(Date.parse(this.anime.premiered))) return false;
        }
        return true;
    }

    public async write(overwriteNfo: boolean = false, includePoster: boolean = true): Promise<boolean> {
        const nfoPath: string = path.join(this.path, 'tvshow.nfo');

        // ensure anime is valid
        if (!this.isValid()) {
            throw new Error('Cannot write invalid data to tvshow.nfo file!');
        }

        // create tvshow.nfo XML data
        const show = create({ version: '1.0', encoding: 'utf-8' }).ele('tvshow');

        show.ele('title').txt(this.anime.title);
        if (this.anime.originaltitle !== undefined) show.ele('originaltitle').txt(this.anime.originaltitle);
        if (this.anime.sorttitle !== undefined) show.ele('sorttitle').txt(this.anime.sorttitle);

        this.anime.uniqueId.forEach((id: UniqueId) => {
            const nfoUniqueId = show.ele('uniqueid');
            let jellyfinCompatibleType = id.type;
            switch (jellyfinCompatibleType) {
                case "anidb":
                    jellyfinCompatibleType = "AniDB";
                    break;
                case "anilist":
                    jellyfinCompatibleType = "AniList";
                    break;
                case "tmdb":
                    jellyfinCompatibleType = "Tmdb";
                    break;
            }
            nfoUniqueId.txt(`${id.id}`);
            nfoUniqueId.att('type', jellyfinCompatibleType);
            nfoUniqueId.att('default', `${id.default === true}`)
        });

        for (const key of ['premiered', 'season', 'episode', 'tagline', 'plot', 'mpaa']) {
            const objKey = key as keyof typeof this.anime;
            if (this.anime[objKey] !== undefined) {
                show.ele(key).txt(`${this.anime[objKey]}`);
            }
        }

        this.anime.tag?.forEach((tag: string) => {
            show.ele('tag').txt(tag);
        });

        this.anime.studio?.forEach((studio: string) => {
            show.ele('studio').txt(studio);
        });

        this.anime.actor?.forEach((actor: Actor) => {
            const actorEle = show.ele('actor');
            actorEle.ele('name').txt(actor.name);
            actorEle.ele('role').txt(actor.role);
            if (actor.order !== undefined) actorEle.ele('order').txt(`${actor.order}`);
        });

        // write tvshow.nfo
        try {
            if (overwriteNfo || !fs.existsSync(nfoPath)) {
                fs.writeFileSync(nfoPath, show.up().end({ prettyPrint: true }));
            }
        } catch (error) {
            return false;
        }

        // write poster.jpg
        if (includePoster && (this.anime.poster !== undefined)) {
            const posterUrl: string = path.join('https://cdn.anidb.net/images/main/', this.anime.poster);
            const posterPath: string = path.join(this.path, 'poster.jpg');
            if (!fs.existsSync(posterPath)) {
                await axios.get(posterUrl, { responseType: 'stream' }).then(async (response) => {
                    const writer = fs.createWriteStream(posterPath, { encoding: 'utf8', mode: 0o660 });
                    response.data.pipe(writer);
                    await util.promisify(stream.finished)(writer);
                });
            }
        }

        return true;
    }
}

export class EpisodeNfo {
    private episode: Episode[];
    private path: string;

    public constructor(episode: Episode[], episodePath: string) {
        this.episode = episode;
        this.path = episodePath;

        // check path exists
        if(!fs.existsSync(this.path) || !fs.statSync(this.path).isFile()) {
            throw new Error(`The path '${this.path}' does not exist or is not a directory!`);
        }
    }

    public toString(): string {
        return `EpisodeNfo(title=${this.episode[0].title})`;
    }

    public isValid(): boolean {
        let isValid = true;

        this.episode = this.episode.map((episode: Episode) => {
            // NOTE: uniqueId must minimally have one entry
            if (Object.values(episode.uniqueId).length < 1) {
                isValid = false;
                return episode;
            }

            // NOTE: if we only have one uniqueId, it must be the default
            if (Object.values(episode.uniqueId).length == 1) {
                episode.uniqueId[0].default = true;
            }

            // NOTE: we need to have exactly one default uniqueId
            if (episode.uniqueId.filter((id: UniqueId) => id.default === true).length !== 1) {
                isValid = false;
                return episode;
            }

            // NOTE: premiered must be YYYY-MM-DD format if specified
            if (episode.premiered) {
                const premieredRegEx = new RegExp(/(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/);
                if (!premieredRegEx.test(episode.premiered)) {
                    isValid = false;
                    return episode;
                }
                if (isNaN(Date.parse(episode.premiered))) {
                    isValid = false;
                    return episode;
                }
            }

            return episode;
        });

        if (this.episode.length == 0) isValid = false;

        return isValid;
    }

    public async write(overwriteNfo: boolean = false): Promise<boolean> {
        const nfoPath = path.format({
            dir: path.dirname(this.path),
            name: path.basename(this.path, path.extname(this.path)),
            ext: '.nfo',
        });

        // ensure episode is valid
        if (!this.isValid()) {
            throw new Error(`Cannot write invalid data to "${nfoPath}" file!`);
        }

        // exit if nfo exists and we do not need to overwrite it
        if (!overwriteNfo && fs.existsSync(nfoPath)) return true;

        // create episode.nfo XML data
        const nfo = fragment({ version: '1.0', encoding: 'utf-8' });

        this.episode.forEach((episode: Episode) => {
            const episodedetails = nfo.ele('episodedetails');
            episodedetails.ele('title').txt(episode.title);

            episode.uniqueId.forEach((id: UniqueId) => {
                const nfoUniqueId = episodedetails.ele('uniqueid');
                let jellyfinCompatibleType = id.type;
                switch (jellyfinCompatibleType) {
                    case "anidb":
                        jellyfinCompatibleType = "AniDB";
                        break;
                    case "anilist":
                        jellyfinCompatibleType = "AniList";
                        break;
                    case "tmdb":
                        jellyfinCompatibleType = "Tmdb";
                        break;
                }
                nfoUniqueId.txt(`${id.id}`);
                nfoUniqueId.att('type', jellyfinCompatibleType);
                nfoUniqueId.att('default', `${id.default === true}`)
            });

            if (episode.originaltitle !== undefined) episodedetails.ele('originaltitle').txt(episode.originaltitle);

            for (const key of ['premiered', 'season', 'episode', 'plot']) {
                const objKey = key as keyof typeof episode;
                if (episode[objKey] !== undefined) {
                    episodedetails.ele(key).txt(`${episode[objKey]}`);
                }
            }
        });

        // write .nfo
        try {
            // NOTE: nfo is a fragment as it has multiple episodedetails
            //       without a root node, this is invalid XML but it is what
            //       kodi/jellyfin expect.
            fs.writeFileSync(nfoPath, '<?xml version="1.0" encoding="utf-8"?>' + "\n" + nfo.end({ prettyPrint: true }));
        } catch (error) {
            return false;
        }

        return true;
    }
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

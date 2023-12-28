declare module 'anidbjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare type AniDB_Show = {
    id: number;
    ageRestricted: boolean;
    type: string;
    episodeCount: number;
    startDate: string;
    endDate: string;
    titles: {
        title: string;
        type?: string;
        language: string;
    }[];
    description: string;
    picture: string;
    url: string;
    creators: {
        id: number;
        type: string;
        name: string;
    }[];
    tags: {
        id: number;
        weight: number;
        localSpoiler: boolean;
        globalSpoiler: boolean;
        name: string;
        description: string;
        updatedAt: string;
        pictureUrl?: string;
    }[];
    characters: {
        id: number;
        type: string;
        updatedAt: string;
        rating: number;
        votes: number;
        name: string;
        gender: string;
        characterType: {
            id: number,
            name: string;
        };
        description: string;
        picture?: string;
        seiyuu: {
            id: number;
            picture?: string;
            name: string;
        }[];
    }[];
    episodes: {
        id: number;
        updatedAt: string;
        episodeNumber: string;
        type: number;
        length: number;
        airDate: string;
        rating: number | null;
        votes: number | null;
        titles: {
            title: string;
            type?: string;
            language: string;
        }[];
        summary: string | null;
    }[];
};

declare class AniDB {
    constructor(credentials: {
        client: string;
        version: string;
    }, options?: {
        baseUrl?: string;
        timeout?: string;
        agent?: string;
        headers?: any;
    });
    opts?: any;
    queryParams?: {
        client: string;
        clientver: string;
        protover: number;
    };

    set options(opts: any);

    anime(id: number): Promise<AniDB_Show>;

    randomRecommendation(): Promise<AniDB_Show>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab

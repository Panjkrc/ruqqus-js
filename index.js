const needle = require("needle");
const chalk = require("chalk");
const { EventEmitter } = require("events");

let user_agent;
let fetchKeys = {}, refreshKeys = {}, scopes = {};

class Client extends EventEmitter {
  /**
   * Creates a new ruqqus-js Client instance.
   * 
   * @param {Object} options The application parameters, including the authorization code.
   */

  constructor(options) {
    super();  

    fetchKeys = {
      client_id: options.id,
      client_secret: options.token,
      grant_type: "code",
      code: options.code,
    };
    refreshKeys = {
      client_id: options.id,
      client_secret: options.token,
      grant_type: "refresh"
    };

    this.online = false,
    this.cache = {
      _postCount: 0,
      _commentCount: 0,
      posts: [],
      comments: []
    };

    if (options.agent) user_agent = options.agent; else user_agent = `ruqqus-js@${fetchKeys.client_id}`;

    this._refreshToken();
    this._checkEvents();
  }
  
  _refreshToken() {
    needle("POST", "https://ruqqus.com/oauth/grant", refreshKeys.refresh_token ? refreshKeys : fetchKeys, { user_agent })
      .then(async (resp) => {
        if (resp.body.oauth_error) {
          console.log(`${chalk.red("FATAL ERR!")} Invalid Authcode - ${chalk.yellow("403 ACCESS_DENIED")}`);
          process.exit();
        }

        if (resp.body.scopes) {
          resp.body.scopes.split(",").forEach(s => {
            scopes[s] = true;
          });
        }

        if (resp.body.refresh_token) refreshKeys.refresh_token = resp.body.refresh_token;
        refreshKeys.access_token = resp.body.access_token;
        let refreshIn = (resp.body.expires_at - 5) * 1000 - Date.now()
        
        console.log(`${chalk.greenBright("SUCCESS!")} Token Acquired!\nNext refresh in: ${chalk.yellow(`${Math.floor(refreshIn / 1000)} seconds`)} ${chalk.blueBright(`(${new Date((resp.body.expires_at - 10) * 1000).toLocaleTimeString("en-US")})`)}`);
        setTimeout(() => { this._refreshToken() }, refreshIn);

        if (!this.online) {
          this.user.data = await this._fetchIdentity();
          this.emit("login");
          this.online = true;
        }
      }).catch(e => console.error(e));
  }

  _checkEvents() {
    setTimeout(() => { this._checkEvents() }, 10000);
    
    if (this.eventNames().includes("post")) {
      needle("GET", "https://ruqqus.com/api/v1/all/listing", { sort: "new" }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } })
        .then((resp) => {
          if (resp.body.error) return;

          resp.body.data.forEach(async (post, i) => {
            if (this.cache.posts.indexOf(post.id) > -1) return;
            this.cache.posts.push(post.id);
            
            if (this.cache._postCount != 0) {
              let postData = await new Post(post.id)._fetchData();
              this.emit("post", new Post(post.id), postData);
            }
          });

          this.cache._postCount++;
        });
    }

    if (this.eventNames().includes("comment")) {
      needle("GET", "https://ruqqus.com/api/v1/front/comments", { sort: "new" }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } })
        .then((resp) => {
          if (resp.body.error) return;

          resp.body.data.forEach(async (comment, i) => {
            if (this.cache.comments.indexOf(comment.id) > -1) return;
            this.cache.comments.push(comment.id);
            
            if (this.cache._commentCount != 0) {
              let commentData = await new Comment(comment.id)._fetchData();
              this.emit("comment", new Comment(comment.id), commentData);
            }
          });

          this.cache._commentCount++;
        });
    }
  }

  async _fetchIdentity() {
    let resp = await needle("GET", "https://ruqqus.com/api/v1/identity", {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

    return await new User(resp.body.username)._fetchData();
  }

  user = {
    data: {}
  }
  
  guilds = {
    /**
     * Gets a guild with the specified name.
     * 
     * @param {String} name The guild name.
     * @returns {Guild}
     */

    get(name) {
      return new Guild(name);
    },

    /**
     * Fetches the data from a guild with the specified name.
     * 
     * @param {String} name The guild name.
     * @returns {Object} The guild data.
     */

    async fetchData(name) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      return await new Guild(name)._fetchData();
    },

    /**
     * Fetches whether or not a guild with the specified name is available.
     * 
     * @param {String} name The guild name.
     * @returns {Boolean}
     */

    async isAvailable(name) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      if (!name) return undefined;
      let resp = await needle("GET", `https://ruqqus.com/api/v1/board_available/${name}`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

      return resp.body.available;
    }
  }

  posts = {
    /**
     * Gets a post with the specified ID.
     * 
     * @param {String} id The post ID.
     * @returns {Post}
     */

    get(id) {
      return new Post(id);
    },

    /**
     * Fetches the data from a post with the specified ID.
     * 
     * @param {String} id The post ID.
     * @returns {Object} The post data.
     */

    async fetchData(id) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      return await new Post(id)._fetchData();
    }
  }

  comments = {
    /**
     * Gets a comment with the specified ID.
     * 
     * @param {String} id The comment ID.
     * @returns {Comment}
     */

    get(id) {
      return new Comment(id);
    },

    /**
     * Fetches the data from a comment with the specified ID.
     * 
     * @param {String} id The comment ID. 
     * @returns {Object} The post data.
     */

    async fetchData(id) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      return await new Comment(id)._fetchData();
    }
  }

  users = {
    /**
     * Gets a user with the specified username.
     * 
     * @param {String} username The user's name.
     * @returns {User}
     */

    get(username) {
      return new User(username);
    },

    /**
     * Fetches the data from a user with the specified username.
     * 
     * @param {String} username The user's name.
     * @returns {Object} The user data.
     */

    async fetchData(username) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      return await new User(username)._fetchData();
    },

    /**
     * Fetches whether or not a user with the specified username is available.
     * 
     * @param {String} username The user's name.
     * @returns {Boolean}
     */
    
    async isAvailable(username) {
      if (!scopes.read) return console.log(`${chalk.red("ERR!")} Missing "Read" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
      if (!username) return undefined;
      let resp = await needle("GET", `https://ruqqus.com/api/v1/is_available/${username}`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

      return Object.values(resp.body)[0];
    }
  }
}

class Guild {
  constructor(name) {
    this.name = name;
  }

  async _fetchData() {
    let resp = await needle("GET", `https://ruqqus.com/api/v1/guild/${this.name}`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

    if (!resp.body.id) return undefined;

    return {
      name: resp.body.name,
      description: {
        text: resp.body.description,
        html: resp.body.description_html
      },
      color: resp.body.color,
      id: resp.body.id,
      full_id: resp.body.fullname,
      link: resp.body.permalink,
      full_link: `https://ruqqus.com${resp.body.permalink}`,
      subscribers: resp.body.subscriber_count,
      guildmasters: resp.body.mods_count,
      icon_url: resp.body.profile_url,
      banner_url: resp.body.banner_url,
      created_at: resp.body.created_utc,
      flags: {
        banned: resp.body.is_banned,
        private: resp.body.is_private,
        restricted: resp.body.is_restricted,
        age_restricted: resp.body.over_18
      }
    }
  }
  
  /**
   * Submits a post to the guild.
   * 
   * @param {String} title The title of the post.
   * @param {String} body The body of the post. Can include HTML and Markdown.
   */

  post(title, body) {
    if (!scopes.create) return console.log(`${chalk.red("ERR!")} Missing "Create" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
    if (!title || title == " ") return console.log(`${chalk.red("ERR!")} No Post Title Provided!`);
    if (!body || body == " ") return console.log(`${chalk.red("ERR!")} No Post Body Provided!`);

    needle("POST", `https://ruqqus.com/api/v1/submit`, { board: this.name, title: title, body: body }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } })
      .then((resp) => {
        if (!resp.body.guild_name == "general") console.log(`${chalk.red("ERR!")} Invalid Guild Name. Post Sent to +general - ${chalk.yellow("404 NOT_FOUND")}`);
      });
  }

  /**
   * Fetches an array of post objects from the guild.
   * 
   * @param {String} sort The post sorting method. Defaults to "new".
   * @param {Number} limit The amount of post objects to return. Defaults to 24.
   * @returns {Array} The post objects.
   */

  async fetchPosts(sort, limit) {
    let posts = [];

    let resp = await needle("GET", `https://ruqqus.com/api/v1/guild/${this.name}/listing`, { sort: sort || "new" }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
    if (limit) resp.body.data.splice(limit, resp.body.data.length - limit);
    
    for await (let post of resp.body.data) {
      posts.push(await new Post(post.id)._fetchData());
    }

    return posts;
  }

  /**
   * Fetches an array of comment objects from the guild.
   * 
   * @param {String} sort The comment sorting method. Defaults to "new".
   * @param {Number} limit The amount of comment objects to return. Defaults to 24.
   * @returns {Array} The comment objects.
   */

  async fetchComments(sort, limit) {
    let comments = [];

    let resp = await needle("GET", `https://ruqqus.com/api/v1/guild/${this.name}/comments`, { sort: sort || "new" }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
    if (limit) resp.body.data.splice(limit, resp.body.data.length - limit);
    
    for await (let comment of resp.body.data) {
      comments.push(await new Comment(comment.id)._fetchData());
    }

    return comments;
  }
}

class Post {
  constructor(id) {
    this.id = id;
  }
  
  async _fetchData() {
    let resp = await needle("GET", `https://ruqqus.com/api/v1/post/${this.id}`, { sort: "top" }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

    if (!resp.body.id) return undefined;

    return {
      author: {
        username: resp.body.author,
        title: resp.body.author_title ? {
          name: resp.body.author_title.text,
          id: resp.body.author_title.id,
          kind: resp.body.author_title.kind,
          color: resp.body.author_title.color
        } : null
      },
      content: {
        title: resp.body.title,
        body: {
          text: resp.body.body,
          html: resp.body.body_html
        },
        domain: resp.body.domain,
        url: resp.body.url,
        thumbnail: resp.body.thumb_url,
        embed: resp.body.embed_url
      },
      votes: {
        score: resp.body.score,
        upvotes: resp.body.upvotes,
        downvotes: resp.body.downvotes,
        voted: resp.body.voted
      },
      id: resp.body.id,
      full_id: resp.body.fullname,
      link: resp.body.permalink,
      full_link: `https://ruqqus.com${resp.body.permalink}`,
      created_at: resp.body.created_utc,
      edited_at: resp.body.edited_utc,
      flags: {
        archived: resp.body.is_archived,
        banned: resp.body.is_banned,
        deleted: resp.body.is_deleted,
        nsfw: resp.body.is_nsfw,
        nsfl: resp.body.is_nsfl,
        edited: resp.body.edited_utc > 0
      },
      guild: {
        name: resp.body.guild_name,
        original_name: resp.body.original_guild_name
      }
    }
  }

  /**
   * Submits a comment to the post.
   * 
   * @param {String} body The body of the comment.
   */

  comment(body) {
    if (!scopes.create) return console.log(`${chalk.red("ERR!")} Missing "Create" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
    needle("POST", "https://ruqqus.com/api/v1/comment", { parent_fullname: `t2_${this.id}`, body: body }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }

  /**
   * Upvotes the post.
   */

  upvote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/post/${this.id}/1`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }
  
  /**
   * Downvotes the post.
   */

  downvote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/post/${this.id}/-1`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }

  /**
   * Removes the client's vote from the post.
   */

  removeVote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/post/${this.id}/0`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }
}

class Comment {
  constructor(id) {
    this.id = id;
  }

  async _fetchData() {
    let resp = await needle("GET", `https://ruqqus.com/api/v1/comment/${this.id}`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

    if (!resp.body.id) return undefined;
    
    return {
      author: {
        username: resp.body.author,
        title: resp.body.title ? {
          name: resp.body.title.text,
          id: resp.body.title.id,
          kind: resp.body.title.kind,
          color: resp.body.title.color
        } : null,
      },
      content: {
        text: resp.body.body,
        html: resp.body.body_html
      },
      votes: {
        score: resp.body.score,
        upvotes: resp.body.upvotes,
        downvotes: resp.body.downvotes
      },
      parent: {
        post: resp.body.post,
        comment: resp.body.parent.startsWith("t3") ? resp.body.parent : null
      },
      id: resp.body.id,
      full_id: resp.body.fullname,
      link: resp.body.permalink,
      full_link: `https://ruqqus.com${resp.body.permalink}`,
      created_at: resp.body.created_utc,
      edited_at: resp.body.edited_utc,
      chain_level: resp.body.level,
      flags: {
        archived: resp.body.is_archived,
        banned: resp.body.is_banned,
        deleted: resp.body.is_deleted,
        nsfw: resp.body.is_nsfw,
        nsfl: resp.body.is_nsfl,
        offensive: resp.body.is_offensive,
        edited: resp.body.edited_utc > 0
      },
      guild: resp.body.guild_name,
    }
  }

  /**
   * Submits a reply to the comment.
   * 
   * @param {String} body The body of the reply.
   */

  reply(body) {
    if (!scopes.create) return console.log(`${chalk.red("ERR!")} Missing "Create" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`);
    needle("POST", "https://ruqqus.com/api/v1/comment", { parent_fullname: `t3_${this.id}`, body: body }, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }

  /**
   * Upvotes the comment.
   */

  upvote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/comment/${this.id}/1`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }

  /** 
   * Downvotes the comment.
   */

  downvote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/comment/${this.id}/-1`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }

  /**
   * Removes the client's vote from the comment.
   */

  removeVote() {
    if (!scopes.vote) return console.log(`${chalk.red("ERR!")} Missing "Vote" Scope - ${chalk.yellow("401 NOT_AUTHORIZED")}`)
    needle("POST", `https://ruqqus.com/api/v1/vote/comment/${this.id}/0`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });
  }
}

class User {
  constructor(username) {
    this.username = username;
  }

  async _fetchData() {
    let resp = await needle("GET", `https://ruqqus.com/api/v1/user/${this.username}`, {}, { user_agent, headers: { Authorization: `Bearer ${refreshKeys.access_token}` } });

    if (!resp.body.id) return undefined;
    
    return {
      username: resp.body.username,
      title: resp.body.title ? {
        name: resp.body.title.text,
        id: resp.body.title.id,
        kind: resp.body.title.kind,
        color: resp.body.title.color
      } : null,
      bio: {
        text: resp.body.bio,
        html: resp.body.bio_html
      },
      stats: {
        posts: resp.body.post_count,
        post_rep: resp.body.post_rep,
        comments: resp.body.comment_count,
        comment_rep: resp.body.comment_rep
      },
      id: resp.body.id,
      full_id: `t1_${resp.body.id}`,
      link: resp.body.permalink,
      full_link: `https://ruqqus.com${resp.body.permalink}`,
      avatar_url: resp.body.profile_url.startsWith("/assets") ? `https://ruqqus.com${resp.body.profile_url}` : resp.body.profile_url,
      banner_url: resp.body.banner_url.startsWith("/assets") ? `https://ruqqus.com${resp.body.banner_url}` : resp.body.banner_url,
      created_at: resp.body.created_utc,
      flags: {
        banned: resp.body.is_banned
      },
      badges: 
        resp.body.badges.map(b => {
          return { 
            name: b.name,
            description: b.text,
            url: b.url,
            created_at: b.created_utc
          }
        }),
    }
  }
}

module.exports = { Client }